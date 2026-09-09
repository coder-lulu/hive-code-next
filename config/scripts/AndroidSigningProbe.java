import java.io.File;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.util.Arrays;
import java.util.HexFormat;

class AndroidSigningProbe {
    public static void main(String[] args) throws Exception {
        char[] storePassword = System.getenv("HIVECODE_ANDROID_KEYSTORE_PASSWORD").toCharArray();
        char[] keyPassword = System.getenv("HIVECODE_ANDROID_KEY_PASSWORD").toCharArray();
        try {
            KeyStore store = KeyStore.getInstance(
                new File(System.getenv("HIVECODE_ANDROID_KEYSTORE_PATH")), storePassword);
            String alias = System.getenv("HIVECODE_ANDROID_KEY_ALIAS");
            if (!(store.getKey(alias, keyPassword) instanceof PrivateKey)) {
                throw new IllegalStateException("Android signing alias is not a private key");
            }
            byte[] certificate = store.getCertificate(alias).getEncoded();
            System.out.println(HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(certificate)));
        } finally {
            Arrays.fill(storePassword, '\0');
            Arrays.fill(keyPassword, '\0');
        }
    }
}
