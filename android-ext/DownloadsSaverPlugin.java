package za.micollects.app;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/* Not a published plugin -- @capacitor/filesystem's "DOCUMENTS"/"EXTERNAL_STORAGE" directories
   resolve to Environment.getExternalStoragePublicDirectory(), a pre-scoped-storage API that this
   app's target SDK can no longer actually write to (every attempt failed with FILE_NOTCREATED,
   independent of permissions or recursive). MediaStore.Downloads is the only permission-free way
   left to put a file somewhere a user can actually find it in their Downloads folder, and no
   published Capacitor plugin doing that is compatible with this project's Capacitor 6 core, so
   this is wired in directly. See android-ext/README.md for how it's copied into the generated
   Android project during CI, since android/ itself is never committed. */
@CapacitorPlugin(name = "DownloadsSaver")
public class DownloadsSaverPlugin extends Plugin {

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String fileName = call.getString("fileName");
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (fileName == null || data == null) {
            call.reject("Missing fileName or data");
            return;
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.NO_WRAP);
        } catch (IllegalArgumentException ex) {
            call.reject("Invalid base64 data");
            return;
        }

        Context context = getContext();
        try {
            String uriString;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                Uri itemUri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (itemUri == null) {
                    call.reject("Could not create entry in Downloads");
                    return;
                }
                OutputStream os = context.getContentResolver().openOutputStream(itemUri);
                if (os == null) {
                    call.reject("Could not open Downloads entry for writing");
                    return;
                }
                os.write(bytes);
                os.close();

                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                context.getContentResolver().update(itemUri, values, null, null);
                uriString = itemUri.toString();
            } else {
                @SuppressWarnings("deprecation")
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) downloadsDir.mkdirs();
                File file = new File(downloadsDir, fileName);
                FileOutputStream fos = new FileOutputStream(file);
                fos.write(bytes);
                fos.close();
                MediaScannerConnection.scanFile(context, new String[] { file.getAbsolutePath() }, new String[] { mimeType }, null);
                uriString = Uri.fromFile(file).toString();
            }

            JSObject ret = new JSObject();
            ret.put("uri", uriString);
            call.resolve(ret);
        } catch (IOException ex) {
            call.reject("SAVE_FAILED: " + ex.getMessage(), ex);
        }
    }
}
