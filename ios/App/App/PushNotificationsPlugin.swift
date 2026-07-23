import UIKit
import UserNotifications
import Capacitor

private enum VIPPushPermission: String {
    case prompt
    case denied
    case granted
}

@objc(PushNotificationsPlugin)
public final class PushNotificationsPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "PushNotificationsPlugin"
    public let jsName = "PushNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unregister", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeliveredNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeDeliveredNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAllDeliveredNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createChannel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listChannels", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteChannel", returnType: CAPPluginReturnPromise),
    ]

    public override func load() {
        bridge?.notificationRouter.pushNotificationHandler = self

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(didRegisterForRemoteNotifications(notification:)),
            name: .capacitorDidRegisterForRemoteNotifications,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(didFailToRegisterForRemoteNotifications(notification:)),
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc public func register(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
        }
        resolve(call)
    }

    @objc public func unregister(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.unregisterForRemoteNotifications()
        }
        resolve(call)
    }

    @objc public override func checkPermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            self.resolve(call, [
                "receive": self.permissionString(for: settings.authorizationStatus),
            ])
        }
    }

    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                self.reject(call, message: error.localizedDescription)
                return
            }

            self.resolve(call, [
                "receive": granted ? VIPPushPermission.granted.rawValue : VIPPushPermission.denied.rawValue,
            ])
        }
    }

    @objc public func getDeliveredNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getDeliveredNotifications { notifications in
            self.resolve(call, [
                "notifications": notifications.map { self.notificationObject(from: $0.request) },
            ])
        }
    }

    @objc public func removeDeliveredNotifications(_ call: CAPPluginCall) {
        let notifications = call.options["notifications"] as? [[String: Any]] ?? []
        let ids = notifications.compactMap { $0["id"] as? String }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
        resolve(call)
    }

    @objc public func removeAllDeliveredNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        DispatchQueue.main.async {
            UIApplication.shared.applicationIconBadgeNumber = 0
        }
        resolve(call)
    }

    @objc public func createChannel(_ call: CAPPluginCall) {
        reject(call, message: "Notification channels are not available on iOS.", code: "UNAVAILABLE")
    }

    @objc public func listChannels(_ call: CAPPluginCall) {
        reject(call, message: "Notification channels are not available on iOS.", code: "UNAVAILABLE")
    }

    @objc public func deleteChannel(_ call: CAPPluginCall) {
        reject(call, message: "Notification channels are not available on iOS.", code: "UNAVAILABLE")
    }

    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        notifyListeners(
            "pushNotificationReceived",
            data: notificationObject(from: notification.request)
        )
        return [.banner, .list, .badge, .sound]
    }

    public func didReceive(response: UNNotificationResponse) {
        var data: [String: Any] = [
            "actionId": actionIdentifier(for: response),
            "notification": notificationObject(from: response.notification.request),
        ]

        if let inputResponse = response as? UNTextInputNotificationResponse {
            data["inputValue"] = inputResponse.userText
        }

        notifyListeners("pushNotificationActionPerformed", data: data, retainUntilConsumed: true)
    }

    @objc private func didRegisterForRemoteNotifications(notification: Notification) {
        if let deviceToken = notification.object as? Data {
            let token = deviceToken.map { String(format: "%02X", $0) }.joined()
            notifyListeners("registration", data: ["value": token], retainUntilConsumed: true)
        } else if let token = notification.object as? String {
            notifyListeners("registration", data: ["value": token], retainUntilConsumed: true)
        } else {
            notifyListeners(
                "registrationError",
                data: ["error": "The iPhone returned an unreadable notification token."],
                retainUntilConsumed: true
            )
        }
    }

    @objc private func didFailToRegisterForRemoteNotifications(notification: Notification) {
        let message = (notification.object as? Error)?.localizedDescription ?? "The iPhone could not register for notifications."
        notifyListeners("registrationError", data: ["error": message], retainUntilConsumed: true)
    }

    private func permissionString(for status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined:
            return VIPPushPermission.prompt.rawValue
        case .denied:
            return VIPPushPermission.denied.rawValue
        case .authorized, .ephemeral, .provisional:
            return VIPPushPermission.granted.rawValue
        @unknown default:
            return VIPPushPermission.prompt.rawValue
        }
    }

    private func actionIdentifier(for response: UNNotificationResponse) -> String {
        switch response.actionIdentifier {
        case UNNotificationDefaultActionIdentifier:
            return "tap"
        case UNNotificationDismissActionIdentifier:
            return "dismiss"
        default:
            return response.actionIdentifier
        }
    }

    private func notificationObject(from request: UNNotificationRequest) -> [String: Any] {
        let content = request.content
        return [
            "id": request.identifier,
            "title": content.title,
            "subtitle": content.subtitle,
            "badge": content.badge ?? 1,
            "body": content.body,
            "data": userInfoObject(from: content.userInfo),
        ]
    }

    private func userInfoObject(from userInfo: [AnyHashable: Any]) -> [String: Any] {
        var data: [String: Any] = [:]

        for (key, value) in userInfo {
            guard let key = key as? String else {
                continue
            }
            data[key] = jsonSafeValue(value)
        }

        return data
    }

    private func jsonSafeValue(_ value: Any) -> Any {
        switch value {
        case let string as String:
            return string
        case let number as NSNumber:
            return number
        case let array as [Any]:
            return array.map { jsonSafeValue($0) }
        case let dictionary as [String: Any]:
            return dictionary.mapValues { jsonSafeValue($0) }
        default:
            return String(describing: value)
        }
    }

    private func resolve(_ call: CAPPluginCall, _ data: [String: Any]? = nil) {
        call.successHandler(CAPPluginCallResult(data), call)
    }

    private func reject(_ call: CAPPluginCall, message: String, code: String? = nil) {
        call.errorHandler(CAPPluginCallError(message: message, code: code, error: nil, data: nil))
    }
}
