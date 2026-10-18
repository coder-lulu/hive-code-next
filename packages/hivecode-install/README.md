# HiveCode Headless installer

This package is the npm entry point for the official Linux installer at
`https://hivekernel.com/install.sh`. It downloads the complete script over HTTPS
into a private temporary directory, then runs Bash. It has no npm dependencies
or install/postinstall hooks.

```sh
npx --yes @hivecode/install --headless
npx --yes @hivecode/install --method standalone --channel stable
```

Requirements: Node.js 18 or newer, Linux, Bash, network access to the official
download service, and the permissions requested by the official installer.
The installer defaults to `--method auto --channel beta`. Methods are `auto`,
`deb`, and `standalone`; channels are `beta` and `stable`. `--headless` is optional.
Run `--help` for usage without any network access or installation.

The official script checks distribution, architecture, libc, and systemd support,
selects an available Runtime artifact, verifies it, and installs its persistent
service. npm is only a bootstrap: the Runtime includes its own pinned Node and
never runs from the npx cache. Runtime availability and support requirements are
the same for both installation entries. This package does not make unsupported
Linux distributions compatible.

Downloads are limited to 1 MiB and 30 seconds. Redirects are rejected. Incomplete
or invalid downloads are never executed. Temporary files are removed on completion,
failure, SIGINT, and SIGTERM. Interactive installation preserves the terminal for
sudo password prompts and forwards signals to Bash; terminal Ctrl+C also reaches
the foreground commands. Without a terminal, signals target the isolated Bash
process group. Bash is forcibly stopped after five seconds if necessary. SIGKILL and machine
power loss cannot run cleanup.

## Release and availability

Source checkout does not imply that the npm package has been published. Before
advertising a working npm command, check `https://registry.npmjs.org/@hivecode%2finstall/latest`.
Require name `@hivecode/install`, a valid version, and bin
`hivecode-install: bin/install.mjs`, then pin that exact version in the displayed
command. A missing package or unavailable registry must show an unavailable state.
Runtime artifact availability must also be checked separately.

The manual `HiveCode npm installer release` workflow requires a release version
matching this package's checked-in version and a genuine `NPM_TOKEN` with publish
permission for `@hivecode/install`. It tests and packs this directory independently
of the desktop workspace, then publishes the inspected tarball to the official
npm registry with the `latest` tag. The installer version is independent of the
Runtime version/channel. No publication occurs merely by merging source changes.

Local checks from this directory:

```sh
npm test
npm pack --dry-run --json
```

## First publication to npmjs.com

The maintainer must control the `@hivecode` user or organization scope, have write
access to its packages, and enable account 2FA. Publish from this package directory,
not the private desktop workspace root. Use Node 24 for maintainer commands.

Before advertising installation, deploy the release backend (including migration
R016), publish the Linux Runtime artifacts, and deploy the official `install.sh`.
Publishing this npm bootstrap alone does not publish any Runtime binaries.

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm test
npm pack --dry-run --json
npm publish --access public --tag latest --registry=https://registry.npmjs.org/
npm view @hivecode/install version --registry=https://registry.npmjs.org/
```

Complete the browser login and 2FA prompts locally. The checked-in first version
is `0.1.0`; published name/version pairs cannot be reused. Subsequent releases
must increase `package.json`'s version. The package contains only `package.json`,
`README.md`, `LICENSE`, `bin/install.mjs`, and `lib/installer.mjs`.

For the existing GitHub Actions workflow, store a granular token with package
write permission and **Bypass 2FA** enabled in the repository secret `NPM_TOKEN`.
Commit the package/workflow first, then run **HiveCode npm installer release** with
the exact checked-in installer version. Do not put the token in source or commands.

For ongoing automation, npm recommends [Trusted Publishing with OIDC](https://docs.npmjs.com/trusted-publishers/).
After creating the package, configure its trusted publisher for GitHub owner
`coder-lulu`, repository `hive-code-next`, and workflow filename
`hivecode-install-npm.yml`. Switching the workflow to OIDC requires Node 22.14+
and npm 11.5.1+, `id-token: write`, direct-publish permission in the npm trusted
publisher settings, and removal of the token requirement above. The checked-in
workflow currently uses `NPM_TOKEN`; configuring OIDC in npm alone does not change it.

See npm's [scoped public package publishing guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).
