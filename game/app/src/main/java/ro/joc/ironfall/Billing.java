package ro.joc.ironfall;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Google Play Billing for the one-time research packs. The game page talks to it as window.IFBilling:
 * buy(productId) starts a purchase; every change is reported back through window.IF_onBilling(owned, prices, msg).
 */
public class Billing {
    static final String[] PRODUCTS = { "pack_air", "pack_artillery", "pack_missiles" };

    private final Activity act;
    private final WebView web;
    private final BillingClient client;
    private final Map<String, ProductDetails> details = new HashMap<>();
    private final Set<String> owned = new HashSet<>();

    Billing(Activity act, WebView web) {
        this.act = act;
        this.web = web;
        client = BillingClient.newBuilder(act)
                .setListener((result, purchases) -> {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
                        for (Purchase p : purchases) handle(p);
                        report("ok");
                    } else if (result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                        refreshPurchases();
                    } else if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
                        report("cancel");
                    } else {
                        report("error");
                    }
                })
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
        connect();
    }

    private void connect() {
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) { report("unavailable"); return; }
                List<QueryProductDetailsParams.Product> list = new ArrayList<>();
                for (String id : PRODUCTS) list.add(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(id).setProductType(BillingClient.ProductType.INAPP).build());
                client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(list).build(), (res, pds) -> {
                    if (pds != null) synchronized (details) { for (ProductDetails pd : pds) details.put(pd.getProductId(), pd); }
                    report("");
                });
                refreshPurchases();
            }
            @Override public void onBillingServiceDisconnected() { }
        });
    }

    private void refreshPurchases() {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(), (res, purchases) -> {
            if (purchases != null) for (Purchase p : purchases) handle(p);
            report("");
        });
    }

    private void handle(Purchase p) {
        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) return;   // pending payments unlock once they clear
        synchronized (owned) { owned.addAll(p.getProducts()); }
        if (!p.isAcknowledged()) client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(p.getPurchaseToken()).build(), r -> { });
    }

    private void report(String msg) {
        try {
            JSONArray o = new JSONArray(); synchronized (owned) { for (String s : owned) o.put(s); }
            JSONObject pr = new JSONObject();
            synchronized (details) { for (ProductDetails pd : details.values()) {
                ProductDetails.OneTimePurchaseOfferDetails d = pd.getOneTimePurchaseOfferDetails();
                if (d != null) pr.put(pd.getProductId(), d.getFormattedPrice()); } }
            final String js = "window.IF_onBilling && IF_onBilling(" + o + "," + pr + "," + JSONObject.quote(msg) + ")";
            act.runOnUiThread(() -> web.evaluateJavascript(js, null));
        } catch (Exception e) { /* ignore */ }
    }

    @JavascriptInterface
    public void buy(String productId) {
        ProductDetails pd; synchronized (details) { pd = details.get(productId); }
        if (pd == null) { report("unavailable"); if (client.isReady()) refreshPurchases(); else connect(); return; }
        BillingFlowParams params = BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(
                BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).build())).build();
        act.runOnUiThread(() -> client.launchBillingFlow(act, params));
    }

    @JavascriptInterface
    public void refresh() { if (client.isReady()) refreshPurchases(); else connect(); }

    void resume() { if (client.isReady()) refreshPurchases(); }
    void destroy() { client.endConnection(); }
}
