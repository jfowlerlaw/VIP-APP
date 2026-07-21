import UIKit
import Capacitor

class AppViewController: UIViewController {
    private let bridgeViewController = CAPBridgeViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.96, green: 0.94, blue: 0.89, alpha: 1)

        addChild(bridgeViewController)
        let bridgeView = bridgeViewController.view!
        bridgeView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bridgeView)

        NSLayoutConstraint.activate([
            bridgeView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bridgeView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bridgeView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            bridgeView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        ])

        bridgeViewController.didMove(toParent: self)
    }

    override var childForStatusBarHidden: UIViewController? {
        bridgeViewController
    }

    override var childForStatusBarStyle: UIViewController? {
        bridgeViewController
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        bridgeViewController.supportedInterfaceOrientations
    }
}
