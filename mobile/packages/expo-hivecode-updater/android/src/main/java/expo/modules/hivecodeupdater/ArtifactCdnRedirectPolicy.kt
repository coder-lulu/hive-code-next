package expo.modules.hivecodeupdater

import java.net.URI
import java.net.URLDecoder

internal object ArtifactCdnRedirectPolicy {
    fun target(location: String, configuredOrigin: String?, redirects: Int, nowSeconds: Long = System.currentTimeMillis() / 1000): URI {
        require(redirects == 0) { "Only one APK CDN redirect is permitted" }
        val target = URI(location)
        val origin = URI(configuredOrigin ?: "")
        fun port(uri: URI): Int = if (uri.port == -1) 443 else uri.port
        val path = target.rawPath ?: ""
        val query = (target.rawQuery ?: "").split('&').map {
            val pair = it.split('=', limit = 2)
            require(pair.size == 2) { "Invalid APK CDN signature" }
            URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair[1], "UTF-8")
        }
        val values = query.toMap()
        val expiry = values["e"]?.takeIf { it.matches(Regex("^[0-9]{1,12}$")) }?.toLongOrNull()
        require(
            origin.scheme.equals("https", true) && target.scheme.equals("https", true) &&
                origin.host != null && target.host.equals(origin.host, true) && port(target) == port(origin) &&
                origin.userInfo == null && target.userInfo == null &&
                origin.rawQuery == null && origin.rawFragment == null && target.rawFragment == null &&
                (origin.rawPath.isNullOrEmpty() || origin.rawPath == "/") &&
                path.startsWith("/releases/") && !Regex("%(2f|5c|00)", RegexOption.IGNORE_CASE).containsMatchIn(path) &&
                !target.path.contains('\\') && target.path.split('/').none { it == "." || it == ".." } &&
                query.size == 2 && values.keys == setOf("e", "token") &&
                expiry != null && expiry > nowSeconds && expiry <= nowSeconds + 3600 &&
                values["token"]!!.matches(Regex("^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+={0,2}$"))
        ) { "APK redirect is outside the configured signed CDN boundary" }
        return target
    }
}
