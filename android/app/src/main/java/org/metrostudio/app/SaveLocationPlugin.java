package org.metrostudio.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

@CapacitorPlugin(name = "SaveLocation")
public class SaveLocationPlugin extends Plugin {
    private static final String PREFERENCES = "metro_studio_settings";
    private static final String DIRECTORY_URI = "save_directory_uri";

    private String getSavedUri() {
        return getContext()
            .getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE)
            .getString(DIRECTORY_URI, "");
    }

    private String getDirectoryLabel(Uri uri) {
        try {
            String documentId = DocumentsContract.getTreeDocumentId(uri);
            int separator = documentId.indexOf(':');
            String path = separator >= 0 ? documentId.substring(separator + 1) : documentId;
            if (path.isBlank()) return "Internal storage";
            int slash = path.lastIndexOf('/');
            return slash >= 0 ? path.substring(slash + 1) : path;
        } catch (Exception ignored) {
            return "Selected folder";
        }
    }

    private JSObject buildLocationResult(boolean canceled) {
        String savedUri = getSavedUri();
        JSObject result = new JSObject();
        result.put("canceled", canceled);
        result.put("configured", !savedUri.isBlank());
        result.put("label", savedUri.isBlank() ? "Ask every time" : getDirectoryLabel(Uri.parse(savedUri)));
        return result;
    }

    @PluginMethod
    public void getLocation(PluginCall call) {
        call.resolve(buildLocationResult(false));
    }

    @PluginMethod
    public void chooseDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );

        String savedUri = getSavedUri();
        if (!savedUri.isBlank()) {
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(savedUri));
        }
        startActivityForResult(call, intent, "chooseDirectoryResult");
    }

    @ActivityCallback
    private void chooseDirectoryResult(PluginCall call, ActivityResult activityResult) {
        Intent data = activityResult.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(buildLocationResult(true));
            return;
        }

        Uri uri = data.getData();
        int flags = data.getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            getContext()
                .getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE)
                .edit()
                .putString(DIRECTORY_URI, uri.toString())
                .apply();
            call.resolve(buildLocationResult(false));
        } catch (Exception error) {
            call.reject("Unable to use the selected folder.", error);
        }
    }

    @PluginMethod
    public void clearLocation(PluginCall call) {
        String savedUri = getSavedUri();
        if (!savedUri.isBlank()) {
            try {
                getContext()
                    .getContentResolver()
                    .releasePersistableUriPermission(
                        Uri.parse(savedUri),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    );
            } catch (Exception ignored) {
                // The provider may already have revoked the grant.
            }
        }
        getContext()
            .getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE)
            .edit()
            .remove(DIRECTORY_URI)
            .apply();
        call.resolve(buildLocationResult(false));
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String savedUri = getSavedUri();
        String filename = call.getString("filename");
        String data = call.getString("data");
        String mimeType = call.getString(
            "mimeType",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        if (savedUri.isBlank()) {
            call.reject("Choose a save folder first.");
            return;
        }
        if (filename == null || filename.isBlank() || data == null || data.isBlank()) {
            call.reject("A filename and file data are required.");
            return;
        }

        try {
            Uri treeUri = Uri.parse(savedUri);
            Uri directoryUri = DocumentsContract.buildDocumentUriUsingTree(
                treeUri,
                DocumentsContract.getTreeDocumentId(treeUri)
            );
            ContentResolver resolver = getContext().getContentResolver();
            Uri fileUri = DocumentsContract.createDocument(resolver, directoryUri, mimeType, filename);
            if (fileUri == null) {
                call.reject("The selected folder could not create the file.");
                return;
            }

            try (OutputStream output = resolver.openOutputStream(fileUri, "w")) {
                if (output == null) {
                    call.reject("The selected folder could not open the file.");
                    return;
                }
                output.write(Base64.decode(data, Base64.DEFAULT));
                output.flush();
            }

            JSObject result = new JSObject();
            result.put("filename", filename);
            result.put("uri", fileUri.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to save the Excel file to the selected folder.", error);
        }
    }
}
