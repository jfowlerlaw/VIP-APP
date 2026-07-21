import UIKit
import Capacitor
import WebKit

class AppViewController: UIViewController {
    private enum ShellTheme {
        case light
        case dark
    }

    private static let lightShellColor = UIColor(red: 0.984, green: 0.973, blue: 0.945, alpha: 1)
    private static let darkShellColor = UIColor(red: 0.090, green: 0.082, blue: 0.075, alpha: 1)

    private let bridgeViewController = ThemedBridgeViewController()
    private var requestedTheme: ShellTheme?

    override func viewDidLoad() {
        super.viewDidLoad()
        bridgeViewController.onThemeChange = { [weak self] theme in
            self?.updateShellTheme(theme)
        }

        addChild(bridgeViewController)
        let bridgeView = bridgeViewController.view!
        applyShellBackground()

        bridgeView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bridgeView)

        NSLayoutConstraint.activate([
            bridgeView.topAnchor.constraint(equalTo: view.topAnchor),
            bridgeView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bridgeView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bridgeView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        ])

        bridgeViewController.didMove(toParent: self)
    }

    private func updateShellTheme(_ theme: String) {
        requestedTheme = theme == "dark" ? .dark : .light
        applyShellBackground()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)

        if requestedTheme == nil {
            applyShellBackground()
        }
    }

    private var activeShellTheme: ShellTheme {
        if let requestedTheme {
            return requestedTheme
        }

        return traitCollection.userInterfaceStyle == .dark ? .dark : .light
    }

    private var shellColor: UIColor {
        activeShellTheme == .dark ? Self.darkShellColor : Self.lightShellColor
    }

    private func applyShellBackground() {
        let color = shellColor
        view.backgroundColor = color
        bridgeViewController.view.backgroundColor = color

        if let webView = bridgeViewController.webView {
            webView.isOpaque = false
            webView.backgroundColor = color
            webView.scrollView.backgroundColor = color
        }

        setNeedsStatusBarAppearanceUpdate()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        if activeShellTheme == .dark {
            return .lightContent
        }

        if #available(iOS 13.0, *) {
            return .darkContent
        }

        return .default
    }

    override var childForStatusBarHidden: UIViewController? {
        bridgeViewController
    }

    override var childForStatusBarStyle: UIViewController? {
        nil
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        bridgeViewController.supportedInterfaceOrientations
    }
}

private final class ThemedBridgeViewController: CAPBridgeViewController {
    var onThemeChange: ((String) -> Void)?

    private let themeMessageName = "nativeTheme"
    private static let themeBridgeScript = """
    (function () {
      function readTheme() {
        var storedTheme = null;

        try {
          storedTheme = window.localStorage.getItem("jcm-vip-theme");
        } catch (error) {}

        var documentTheme = document.documentElement.getAttribute("data-theme");

        if (documentTheme === "dark" || documentTheme === "light") {
          return documentTheme;
        }

        if (storedTheme === "dark" || storedTheme === "light") {
          return storedTheme;
        }

        if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
          return "dark";
        }

        return "light";
      }

      function postTheme() {
        try {
          window.webkit.messageHandlers.nativeTheme.postMessage(readTheme());
        } catch (error) {}
      }

      postTheme();
      document.addEventListener("DOMContentLoaded", postTheme);

      try {
        new MutationObserver(postTheme).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });
      } catch (error) {}
    })();
    """
    private lazy var themeMessageHandler = ThemeScriptMessageHandler { [weak self] theme in
        self?.onThemeChange?(theme)
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        guard let userContentController = webView?.configuration.userContentController else {
            return
        }

        userContentController.add(themeMessageHandler, name: themeMessageName)
        userContentController.addUserScript(
            WKUserScript(
                source: Self.themeBridgeScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: themeMessageName)
    }
}

private final class ThemeScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private let onThemeChange: (String) -> Void

    init(onThemeChange: @escaping (String) -> Void) {
        self.onThemeChange = onThemeChange
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let theme = message.body as? String else {
            return
        }

        onThemeChange(theme)
    }
}
