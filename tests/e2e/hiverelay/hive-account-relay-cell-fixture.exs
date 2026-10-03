alias HiveRelay.{Config, Domain, Listener}
for app <- [:crypto, :ssl, :cowboy, :jason], do: Application.ensure_all_started(app)
{:ok, _} = PaseoRelay.Metrics.start_link([])
directory = System.fetch_env!("HIVE_P4_CELL_FIXTURE")
input = File.read!(Path.join(directory, "input.json")) |> Jason.decode!()
{:ok, reservation} = :gen_tcp.listen(0, ip: {127, 0, 0, 1})
{:ok, port} = :inet.port(reservation)
:gen_tcp.close(reservation)

private_config =
  if pki = input["privatePki"] do
    {:ok, socket} = :gen_tcp.listen(0, ip: {127, 0, 0, 1})
    {:ok, private_port} = :inet.port(socket)
    :gen_tcp.close(socket)

    %{
      private_ip: {127, 0, 0, 1},
      private_port: private_port,
      private_origin: "https://localhost:#{private_port}",
      private_tls: [
        certfile: String.to_charlist(pki["serverCertPath"]),
        keyfile: String.to_charlist(pki["serverKeyPath"]),
        cacertfile: String.to_charlist(pki["caPemPath"]),
        verify: :verify_peer,
        fail_if_no_peer_cert: true
      ]
    }
  else
    %{}
  end

config =
  Map.merge(Config.defaults(), %{
    cell_id: input["cellId"],
    issuer: "https://hive.example/relay",
    active_kid: "relay-test-key",
    public_ip: {127, 0, 0, 1},
    public_port: port,
    public_origin: "https://localhost:#{port}",
    browser_origins: input["browserOrigins"],
    authenticated_slots: Map.get(input, "authenticatedSlots", 32),
    public_tls: [
      certfile: String.to_charlist(Path.join(directory, "cert.pem")),
      keyfile: String.to_charlist(Path.join(directory, "key.pem"))
    ],
    keys: %{
      "relay-test-key" => %{
        public_key: Base.decode64!(input["relaySigningPublicKey"]),
        purpose: "cloud-relay-ed25519",
        alg: "EdDSA",
        curve: "Ed25519"
      }
    }
  })
  |> Map.merge(private_config)
  |> Config.enrich()

{:ok, domain} = Domain.start_link(config)
identity = Domain.identity(domain)
now = System.system_time(:millisecond)

command = %{
  "type" => "cell-lifecycle-command",
  "v" => 2,
  "commandType" => "INCARNATION_ACTIVATE",
  "commandId" => "bcdac2b6-2793-441c-9021-41425d64b08d",
  "cellId" => identity["cellId"],
  "targetIncarnationId" => identity["cellIncarnationId"],
  "lifecycleGeneration" => 1,
  "issuedAt" => now,
  "deadlineAt" => now + 120_000
}

claims = %{
  "cellId" => identity["cellId"],
  "exp" => div(now, 1000) + 30,
  "jti" => "bcdac2b6-2793-441c-9021-41425d64b08e",
  "nonce" => Base.url_encode64(<<0::128>>, padding: false),
  "scope" => "relay:cell:lifecycle"
}

{:ok, %{"result" => "APPLIED"}} = Domain.ops(domain, claims, command)
listeners = [Listener.spec(:public, config, domain)]

listeners =
  if input["privatePki"],
    do: listeners ++ [Listener.spec(:private, config, domain)],
    else: listeners

{:ok, _} = Supervisor.start_link(listeners, strategy: :one_for_one)

File.write!(
  Path.join(directory, "ready.json"),
  Jason.encode!(
    identity
    |> Map.put("port", :ranch.get_port(:hive_relay_public))
    |> Map.put("processPid", :os.getpid() |> List.to_string())
    |> Map.put("privateOrigin", private_config[:private_origin])
    |> Map.put("caPemPath", get_in(input, ["privatePki", "caPemPath"]))
    |> Map.put("clientPkcs12Path", get_in(input, ["privatePki", "clientPkcs12Path"]))
  )
)

default_lifetime =
  if System.get_env("HIVE_RELAY_CLOUD_PAUSE_TEST") == "1", do: 300_000, else: 90_000

lifetime = Map.get(input, "lifetimeMs", default_lifetime)

wait = fn wait ->
  if File.exists?(Path.join(directory, "stop")) or
       System.system_time(:millisecond) > now + lifetime,
     do: :ok,
     else:
       (
         if Map.has_key?(input, "lifetimeMs") do
           observation = %{
             "observedAt" => System.system_time(:millisecond),
             "status" => Domain.status(domain),
             "metrics" => Domain.metrics(domain)
           }

           temporary = Path.join(directory, "observation.json.tmp")
           File.write!(temporary, Jason.encode!(observation))
           File.rename!(temporary, Path.join(directory, "observation.json"))
           Process.sleep(1000)
         else
           Process.sleep(100)
         end

         wait.(wait)
       )
end

wait.(wait)
