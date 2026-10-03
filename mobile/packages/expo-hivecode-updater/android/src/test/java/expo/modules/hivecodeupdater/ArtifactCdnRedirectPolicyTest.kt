package expo.modules.hivecodeupdater

// Standalone JVM regression entry point; no Android runtime or test dependency required.
fun main() {
    val origin = "https://oss.cloud.hivekernel.com"
    val now = 1_800_000_000L
    val signed = "$origin/releases/android/HiveCode%20Setup.apk?e=${now + 600}&token=test:signature_123%3D"
    check(ArtifactCdnRedirectPolicy.target(signed, origin, 0, now).host == "oss.cloud.hivekernel.com")
    val rejected = listOf(
        signed.replace("https:", "http:"),
        signed.replace("oss.cloud.hivekernel.com", "oss.cloud.hivekernel.com.attacker.test"),
        signed.replace("/releases/", "/metadata/"),
        signed.replace("/android/", "/android%2f"),
        signed.replace("/android/", "/android%5c"),
        signed.replace("/android/", "/%2e%2e/"),
        signed.replace((now + 600).toString(), now.toString()),
        signed.replace((now + 600).toString(), (now + 3601).toString()),
        "$signed&e=${now + 600}",
        "$signed&attname=setup.apk",
        "$signed#fragment",
        signed.replace("https://", "https://user:pass@")
    )
    rejected.forEach { url ->
        check(runCatching { ArtifactCdnRedirectPolicy.target(url, origin, 0, now) }.isFailure)
    }
    listOf(null, "$origin/path", "$origin?query", "$origin#fragment", "http://oss.cloud.hivekernel.com").forEach { configured ->
        check(runCatching { ArtifactCdnRedirectPolicy.target(signed, configured, 0, now) }.isFailure)
    }
    check(runCatching { ArtifactCdnRedirectPolicy.target(signed, origin, 1, now) }.isFailure)
    println("ArtifactCdnRedirectPolicy: 19 assertions passed")
}
