import SwiftUI

/// The web's `.btn-primary`: accent fill, pill-ish radius, calm press state.
public struct BloomPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .padding(.vertical, BloomSpacing.s2 + 2)
            .padding(.horizontal, BloomSpacing.s4)
            .foregroundStyle(BloomPalette.accentInk)
            .background(
                RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall, style: .continuous)
                    .fill(BloomPalette.accent)
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45)
            .animation(.easeOut(duration: 0.18), value: configuration.isPressed)
    }
}

/// The web's `.btn`: quiet outlined button on the surface color.
public struct BloomQuietButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.medium))
            .padding(.vertical, BloomSpacing.s1 + 2)
            .padding(.horizontal, BloomSpacing.s3)
            .foregroundStyle(BloomPalette.ink)
            .background(
                RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall, style: .continuous)
                    .fill(configuration.isPressed ? BloomPalette.surfaceMuted : BloomPalette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall, style: .continuous)
                    .strokeBorder(BloomPalette.border)
            )
            .opacity(isEnabled ? 1 : 0.5)
    }
}

extension ButtonStyle where Self == BloomPrimaryButtonStyle {
    public static var bloomPrimary: BloomPrimaryButtonStyle { BloomPrimaryButtonStyle() }
}

extension ButtonStyle where Self == BloomQuietButtonStyle {
    public static var bloomQuiet: BloomQuietButtonStyle { BloomQuietButtonStyle() }
}

/// The web's `.card`: surface fill, hairline border, soft radius.
public struct BloomCard: ViewModifier {
    public func body(content: Content) -> some View {
        content
            .padding(BloomSpacing.s4)
            .background(
                RoundedRectangle(cornerRadius: BloomSpacing.radius, style: .continuous)
                    .fill(BloomPalette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: BloomSpacing.radius, style: .continuous)
                    .strokeBorder(BloomPalette.border)
            )
    }
}

extension View {
    /// Wraps the view in Bloom's card treatment.
    public func bloomCard() -> some View { modifier(BloomCard()) }
}
