package com.mas.player

import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.app.UiModeManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  // Fullscreen video uses the whole screen, cutout included, so it sits centred.
  private var fullscreen = false

  // Picture in picture: what the player last reported.
  private var pipPlaying = false
  private var pipWidth = 16
  private var pipHeight = 9

  private val pipToggleAction = "com.mas.player.PIP_TOGGLE"
  private val pipReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      js("window.__streamPlayerPipToggle && window.__streamPlayerPipToggle()")
    }
  }

  // The web UI decides what Back means (leave fullscreen, close the player, go back a page).
  override val handleBackNavigation: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val view = webView ?: return finish()
        view.evaluateJavascript("(window.__streamPlayerBack ? window.__streamPlayerBack() : false)") { handled ->
          if (handled != "true") {
            if (view.canGoBack()) view.goBack() else finish()
          }
        }
      }
    })

    ContextCompat.registerReceiver(this, pipReceiver, IntentFilter(pipToggleAction), ContextCompat.RECEIVER_NOT_EXPORTED)
  }

  override fun onDestroy() {
    runCatching { unregisterReceiver(pipReceiver) }
    super.onDestroy()
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    // Streams start from the user's own Play tap, but channel switching and
    // autoplay after load happen without a fresh gesture.
    webView.settings.mediaPlaybackRequiresUserGesture = false
    webView.addJavascriptInterface(Host(), "StreamPlayerHost")

    // The app draws edge to edge; keep the WebView clear of the status and
    // navigation bars. When fullscreen hides the bars the insets drop to zero.
    window.decorView.setBackgroundColor(Color.BLACK)
    @Suppress("DEPRECATION")
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val bars = if (fullscreen) androidx.core.graphics.Insets.NONE
        else insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      // The keyboard shrinks the page too, so the docked link bar stays above it.
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      (view.layoutParams as? ViewGroup.MarginLayoutParams)?.let {
        it.setMargins(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
        view.layoutParams = it
      }
      WindowInsetsCompat.CONSUMED
    }
    if (isTv()) applySystemBarsHidden(true)
  }

  private fun js(script: String) {
    webView?.post { webView?.evaluateJavascript(script, null) }
  }

  private fun isTv(): Boolean {
    val uiMode = getSystemService(UI_MODE_SERVICE) as UiModeManager
    return uiMode.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
      packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
  }

  private fun applySystemBarsHidden(on: Boolean) {
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    if (on) {
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.systemBars())
    } else {
      controller.show(WindowInsetsCompat.Type.systemBars())
    }
  }

  /* ---------- Picture in picture ---------- */

  private fun canPip(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !isTv() &&
      packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  private fun pipParams(): PictureInPictureParams? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    // Android only accepts aspect ratios between 1:2.39 and 2.39:1.
    val ratio = (pipWidth.toFloat() / pipHeight.coerceAtLeast(1)).coerceIn(1 / 2.39f, 2.39f)
    val aspect = Rational((ratio * 1000).toInt(), 1000)
    val intent = PendingIntent.getBroadcast(
      this, 0, Intent(pipToggleAction).setPackage(packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val label = getString(if (pipPlaying) R.string.pip_pause else R.string.pip_play)
    val icon = Icon.createWithResource(this, if (pipPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
    val builder = PictureInPictureParams.Builder()
      .setAspectRatio(aspect)
      .setActions(listOf(RemoteAction(icon, label, label, intent)))
    // Android 12+: slide into PiP smoothly when going home while a stream plays.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled(pipPlaying).setSeamlessResizeEnabled(false)
    }
    return builder.build()
  }

  private fun enterPip() {
    if (!canPip() || isInPictureInPictureMode) return
    pipParams()?.let { runCatching { enterPictureInPictureMode(it) } }
  }

  // Before Android 12 there's no auto-enter; going home while playing starts PiP here.
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (pipPlaying && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) enterPip()
  }

  // WryActivity pauses the WebView (and with it, every video) in onPause. Entering PiP
  // also pauses the activity, so undo that and keep the stream going.
  override fun onPause() {
    val keepPlaying = isInPictureInPictureMode && pipPlaying
    super.onPause()
    if (isInPictureInPictureMode) {
      webView?.onResume()
      if (keepPlaying) js("window.__streamPlayerPipResume && window.__streamPlayerPipResume()")
    }
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    webView?.let { view ->
      if (isInPictureInPictureMode) {
        // The small PiP window has no bars or cutout; drop the edge margins.
        (view.layoutParams as? ViewGroup.MarginLayoutParams)?.let {
          it.setMargins(0, 0, 0, 0)
          view.layoutParams = it
        }
      } else {
        ViewCompat.requestApplyInsets(view)
      }
    }
    js("window.__streamPlayerPip && window.__streamPlayerPip($isInPictureInPictureMode)")
  }

  // Closing the PiP window, or leaving the app without PiP, stops the app: pause the stream.
  override fun onStop() {
    super.onStop()
    if (!isChangingConfigurations) js("window.__streamPlayerStopped && window.__streamPlayerStopped()")
  }

  /** Small bridge for the web UI. Methods run on a binder thread, so UI work is posted. */
  inner class Host {
    @JavascriptInterface
    fun isTv(): Boolean = this@MainActivity.isTv()

    @JavascriptInterface
    fun setFullscreen(on: Boolean) = runOnUiThread {
      if (!isTv()) {
        fullscreen = on
        applySystemBarsHidden(on)
        webView?.let { ViewCompat.requestApplyInsets(it) }
        requestedOrientation = if (on) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }
    }

    @JavascriptInterface
    fun setKeepScreenOn(on: Boolean) = runOnUiThread {
      if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    @JavascriptInterface
    fun canPip(): Boolean = this@MainActivity.canPip()

    /** The player reports play state and video size so PiP has the right shape and button. */
    @JavascriptInterface
    fun setPipState(playing: Boolean, width: Int, height: Int) = runOnUiThread {
      pipPlaying = playing
      if (width > 0 && height > 0) {
        pipWidth = width
        pipHeight = height
      }
      if (canPip()) pipParams()?.let { runCatching { setPictureInPictureParams(it) } }
    }

    @JavascriptInterface
    fun enterPip() = runOnUiThread { this@MainActivity.enterPip() }
  }
}
