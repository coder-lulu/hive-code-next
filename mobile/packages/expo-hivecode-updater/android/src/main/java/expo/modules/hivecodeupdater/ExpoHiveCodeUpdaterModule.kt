package expo.modules.hivecodeupdater

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

class ExpoHiveCodeUpdaterModule : Module() {
    private val maximumApkBytes = 512L * 1024L * 1024L
    private val artifactPath = Regex(
        "^/hive/v1/update-artifacts/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/download$"
    )

    override fun definition() = ModuleDefinition {
        Name("ExpoHiveCodeUpdater")

        AsyncFunction("requestApkInstallPermission") {
            val context = appContext.reactContext
                ?: error("Android application context is unavailable")
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
                context.packageManager.canRequestPackageInstalls()
            ) {
                return@AsyncFunction true
            }
            context.startActivity(Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")
            ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
            false
        }

        AsyncFunction("downloadVerifiedApk") {
                downloadUrl: String,
                allowedOrigin: String,
                expectedSize: Long,
                expectedSha256: String ->
            val context = appContext.reactContext
                ?: error("Android application context is unavailable")
            require(expectedSize in 1..maximumApkBytes) {
                "APK size is outside the permitted range"
            }
            require(expectedSha256.matches(Regex("^[0-9a-fA-F]{64}$"))) {
                "APK SHA-256 is invalid"
            }
            val source = URI(downloadUrl)
            val origin = URI(allowedOrigin)
            requireValidDownloadUri(source, origin)

            val updateDirectory = File(context.cacheDir, "hivecode-updates").apply { mkdirs() }
            require(updateDirectory.isDirectory) { "APK cache directory is unavailable" }
            updateDirectory.listFiles()?.forEach { stale ->
                if (stale.isFile && stale.name.startsWith("hivecode-update-")) {
                    stale.delete()
                }
            }
            val identity = UUID.randomUUID().toString()
            val partial = File(updateDirectory, "hivecode-update-$identity.apk.partial")
            val completed = File(updateDirectory, "hivecode-update-$identity.apk")
            try {
                downloadAndVerify(source.toURL(), partial, expectedSize, expectedSha256)
                require(partial.renameTo(completed)) { "Could not finalize verified APK" }
                FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.hivecode.updater.files",
                    completed
                ).toString()
            } catch (failure: Throwable) {
                partial.delete()
                completed.delete()
                throw failure
            }
        }

        AsyncFunction("deleteDownloadedApk") { contentUri: String ->
            val context = appContext.reactContext
                ?: error("Android application context is unavailable")
            val uri = Uri.parse(contentUri)
            val expectedAuthority = "${context.packageName}.hivecode.updater.files"
            val fileName = uri.lastPathSegment ?: ""
            if (uri.scheme == "content" && uri.authority == expectedAuthority &&
                fileName.matches(Regex("^hivecode-update-[0-9a-f-]+\\.apk$"))) {
                File(File(context.cacheDir, "hivecode-updates"), fileName).delete()
            }
        }

        AsyncFunction("openApkInstaller") { contentUri: String ->
            val context = appContext.reactContext
                ?: error("Android application context is unavailable")
            val uri = Uri.parse(contentUri)
            require(uri.scheme == "content") {
                "APK installer requires a content:// URI"
            }
            val allowedAuthorities = setOf(
                "${context.packageName}.FileSystemFileProvider",
                "${context.packageName}.hivecode.updater.files"
            )
            val path = uri.path ?: ""
            require(
                !uri.isOpaque &&
                    !contentUri.contains('%') &&
                    uri.authority != null && allowedAuthorities.contains(uri.authority) &&
                    path.isNotBlank() &&
                    path.endsWith(".apk", ignoreCase = true) &&
                    path.split('/').none { it == "." || it == ".." } &&
                    uri.query == null &&
                    uri.fragment == null
            ) {
                "APK installer requires a provider-backed content URI"
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !context.packageManager.canRequestPackageInstalls()
            ) {
                context.startActivity(Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}")
                ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
                error("请在系统设置中允许 HiveCode 安装未知应用，然后重试")
            }
            val intent = Intent(Intent.ACTION_VIEW).apply {
                // Intent.setType() clears data that was set separately (and
                // setData() clears the type). Set both atomically or the
                // Package Installer receives ACTION_VIEW without the APK URI.
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                // Some Package Installer implementations ignore a grant on
                // `data` alone. ClipData carries the same read grant through
                // the resolver without exposing a writable URI.
                clipData = ClipData.newRawUri("HiveCode APK", uri)
            }

            require(intent.resolveActivity(context.packageManager) != null) {
                "No Android Package Installer is available"
            }
            context.startActivity(intent)
        }
    }

    private fun requireValidDownloadUri(source: URI, origin: URI) {
        fun effectivePort(uri: URI): Int = if (uri.port == -1) 443 else uri.port
        require(
            source.scheme.equals("https", ignoreCase = true) &&
                origin.scheme.equals("https", ignoreCase = true) &&
                source.host != null &&
                source.host.equals(origin.host, ignoreCase = true) &&
                effectivePort(source) == effectivePort(origin) &&
                source.userInfo == null && origin.userInfo == null &&
                source.rawQuery == null && source.rawFragment == null &&
                origin.rawQuery == null && origin.rawFragment == null &&
                (origin.rawPath.isNullOrEmpty() || origin.rawPath == "/") &&
                !source.rawPath.contains('%') && artifactPath.matches(source.rawPath)
        ) {
            "APK URL is outside the configured HiveCloud gateway"
        }
    }

    private fun downloadAndVerify(
        source: URL,
        destination: File,
        expectedSize: Long,
        expectedSha256: String
    ) {
        val connection = source.openConnection() as? HttpsURLConnection
            ?: error("APK download requires HTTPS")
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.requestMethod = "GET"
        connection.setRequestProperty("Accept", "application/vnd.android.package-archive")
        connection.setRequestProperty("Accept-Encoding", "identity")
        connection.setRequestProperty("User-Agent", "HiveCode-Android-Updater/1")
        try {
            val status = connection.responseCode
            require(status == HttpURLConnection.HTTP_OK) {
                "HiveCloud APK download failed ($status); redirects are not allowed"
            }
            val contentType = connection.contentType?.substringBefore(';')?.trim()?.lowercase()
            require(
                contentType == "application/vnd.android.package-archive" ||
                    contentType == "application/octet-stream"
            ) { "HiveCloud returned a non-APK content type" }
            val declaredSize = connection.contentLengthLong
            require(declaredSize == -1L || declaredSize == expectedSize) {
                "APK Content-Length did not match release metadata"
            }
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            connection.inputStream.use { input ->
                FileOutputStream(destination).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count == -1) break
                        total += count
                        require(total <= expectedSize && total <= maximumApkBytes) {
                            "APK exceeded the permitted download size"
                        }
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                }
            }
            require(total == expectedSize) { "APK download was incomplete" }
            val actualSha256 = digest.digest().joinToString("") {
                "%02x".format(it.toInt() and 0xff)
            }
            require(actualSha256.equals(expectedSha256, ignoreCase = true)) {
                "APK SHA-256 verification failed"
            }
        } finally {
            connection.disconnect()
        }
    }
}
