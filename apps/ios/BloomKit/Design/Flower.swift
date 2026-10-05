import SwiftUI

/// Bloom's mark: five petals around a sage center. Mirrors
/// `apps/web/src/lib/components/Flower.svelte`, including the three states.
public enum FlowerState: String, CaseIterable, Sendable {
    /// Resting: petals folded in.
    case closed
    /// Thinking: petals half open and breathing.
    case opening
    /// Has something for you: petals fully spread.
    case open
}

/// Petal pose in the 64×64 design space of the SVG mark. The web applies
/// `scale(x, y) translateY(shift)` to an ellipse (rx 6, ry 14) centred 13
/// units above the flower's middle; this is that transform, precomputed.
public struct PetalPose: Equatable, Sendable {
    public var scaleX: Double
    public var scaleY: Double
    public var shiftY: Double
    public var opacity: Double

    /// Distance from the flower's middle to the petal's centre, design units.
    public var centerOffset: Double { (13 - shiftY) * scaleY }
    /// Petal half-width and half-height, design units.
    public var radiusX: Double { 6 * scaleX }
    public var radiusY: Double { 14 * scaleY }

    public static func resting(_ state: FlowerState) -> PetalPose {
        switch state {
        case .closed: PetalPose(scaleX: 0.55, scaleY: 0.7, shiftY: 6, opacity: 0.7)
        case .opening: PetalPose(scaleX: 0.8, scaleY: 0.9, shiftY: 2, opacity: 0.92)
        case .open: PetalPose(scaleX: 1, scaleY: 1, shiftY: 0, opacity: 0.92)
        }
    }

    /// The far end of the "opening" breath (the web's `breathe` keyframe at 50%).
    public static let breathIn = PetalPose(scaleX: 0.95, scaleY: 1, shiftY: 0, opacity: 0.92)
}

/// One petal, pointing up from the centre of its frame. Animatable, so
/// state changes ease rather than snap.
struct PetalShape: Shape {
    var pose: PetalPose

    var animatableData: AnimatablePair<AnimatablePair<Double, Double>, Double> {
        get { AnimatablePair(AnimatablePair(pose.scaleX, pose.scaleY), pose.shiftY) }
        set {
            pose.scaleX = newValue.first.first
            pose.scaleY = newValue.first.second
            pose.shiftY = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        let unit = min(rect.width, rect.height) / 64
        let rx = pose.radiusX * unit
        let ry = pose.radiusY * unit
        let cy = rect.midY - pose.centerOffset * unit
        return Path(ellipseIn: CGRect(x: rect.midX - rx, y: cy - ry, width: rx * 2, height: ry * 2))
    }
}

/// The flower mark at a given size and state.
public struct Flower: View {
    public static let petalAngles: [Double] = [0, 72, 144, 216, 288]
    /// The web's `cubic-bezier(0.2, 0.7, 0.2, 1)` over 600 ms.
    static let settle = Animation.timingCurve(0.2, 0.7, 0.2, 1, duration: 0.6)

    let state: FlowerState
    let size: CGFloat
    let label: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    public init(state: FlowerState = .open, size: CGFloat = 24, label: String = "Bloom") {
        self.state = state
        self.size = size
        self.label = label
    }

    private var pose: PetalPose {
        state == .opening && breathing && !reduceMotion ? .breathIn : .resting(state)
    }

    public var body: some View {
        ZStack {
            ForEach(Self.petalAngles, id: \.self) { angle in
                PetalShape(pose: pose)
                    .fill(BloomPalette.accent)
                    .opacity(pose.opacity)
                    .rotationEffect(.degrees(angle))
            }
            Circle()
                .fill(BloomPalette.sage)
                .frame(width: size * 13 / 64, height: size * 13 / 64)
        }
        .frame(width: size, height: size)
        .animation(Self.settle, value: state)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isImage)
        .onChange(of: state, initial: true) { _, next in
            breathe(next == .opening)
        }
    }

    private func breathe(_ on: Bool) {
        guard on, !reduceMotion else {
            // A new transaction replaces the repeating one, so the petals settle.
            withAnimation(Self.settle) { breathing = false }
            return
        }
        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
            breathing = true
        }
    }
}

#Preview("States") {
    HStack(spacing: 32) {
        ForEach(FlowerState.allCases, id: \.self) { state in
            VStack {
                Flower(state: state, size: 64)
                Text(state.rawValue).font(.caption)
            }
        }
    }
    .padding()
    .background(BloomPalette.page)
}
