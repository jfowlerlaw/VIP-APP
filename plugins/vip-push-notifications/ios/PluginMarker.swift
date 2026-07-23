import Foundation

// Capacitor scans plugin source files for @objc names during sync.
// The implementation is compiled by the app target at ios/App/App/PushNotificationsPlugin.swift.
@objc(PushNotificationsPlugin)
final class VIPPushNotificationsPluginMarker: NSObject {}
