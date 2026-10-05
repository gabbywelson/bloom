import SwiftUI
import UIKit

/// Bloom's palette, mirroring the CSS custom properties in
/// `apps/web/src/app.css` so the web app and the iOS app look like one
/// product. Every color has a light and a dark value and resolves with the
/// current trait collection.
public enum BloomPalette {
    public static let page = Color(light: 0xF5EFE4, dark: 0x1D1A17)
    public static let surface = Color(light: 0xFBF7EF, dark: 0x26221E)
    public static let surfaceMuted = Color(light: 0xEFE7D8, dark: 0x2F2A25)
    public static let ink = Color(light: 0x2A2622, dark: 0xEFE7DA)
    public static let inkMuted = Color(light: 0x6B625A, dark: 0xB3A89A)
    public static let inkFaint = Color(light: 0x9A8F84, dark: 0x7F756A)
    public static let accent = Color(light: 0x9F512E, dark: 0xCF7C59)
    public static let accentInk = Color(light: 0xFFF8F2, dark: 0x1D1A17)
    public static let sage = Color(light: 0x7A8B6F, dark: 0x93A487)
    public static let sageSoft = Color(light: 0xDFE5D7, dark: 0x333A2F)
    public static let border = Color(light: 0xE3D9C6, dark: 0x3A332C)
    public static let danger = Color(light: 0x9C3F2F, dark: 0xD9775F)
}

/// The web's spacing scale (`--space-1` … `--space-7`) and radii.
public enum BloomSpacing {
    public static let s1: CGFloat = 4
    public static let s2: CGFloat = 8
    public static let s3: CGFloat = 12
    public static let s4: CGFloat = 16
    public static let s5: CGFloat = 24
    public static let s6: CGFloat = 32
    public static let s7: CGFloat = 48

    public static let radius: CGFloat = 12
    public static let radiusSmall: CGFloat = 8
}

/// An sRGB color split into components, from a `0xRRGGBB` literal.
public struct RGB: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(hex: UInt32) {
        red = Double((hex >> 16) & 0xFF) / 255
        green = Double((hex >> 8) & 0xFF) / 255
        blue = Double(hex & 0xFF) / 255
    }
}

extension UIColor {
    convenience init(rgb: RGB) {
        self.init(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
    }
}

extension Color {
    /// A color that follows the light/dark appearance.
    public init(light: UInt32, dark: UInt32) {
        let light = RGB(hex: light)
        let dark = RGB(hex: dark)
        self.init(uiColor: UIColor { traits in
            UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}
