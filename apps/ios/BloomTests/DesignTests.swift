import BloomKit
import Testing

@Suite("Design tokens")
struct DesignTests {
    @Test("hex literals split into sRGB components")
    func rgbFromHex() {
        let accent = RGB(hex: 0x9F512E)
        #expect(accent.red == 159.0 / 255)
        #expect(accent.green == 81.0 / 255)
        #expect(accent.blue == 46.0 / 255)
        #expect(RGB(hex: 0x000000) == RGB(hex: 0))
        #expect(RGB(hex: 0xFFFFFF).red == 1)
    }

    @Test("petal poses match the web's CSS transforms")
    func petalPoses() {
        let closed = PetalPose.resting(.closed)
        // scale(0.55, 0.7) translateY(6px) applied to an ellipse rx 6, ry 14 at cy -13.
        #expect(abs(closed.centerOffset - 4.9) < 1e-9)
        #expect(abs(closed.radiusX - 3.3) < 1e-9)
        #expect(abs(closed.radiusY - 9.8) < 1e-9)
        #expect(closed.opacity == 0.7)

        let open = PetalPose.resting(.open)
        #expect(open.centerOffset == 13)
        #expect(open.radiusX == 6)
        #expect(open.radiusY == 14)
    }

    @Test("petals spread monotonically from closed to open", arguments: [
        (FlowerState.closed, FlowerState.opening),
        (FlowerState.opening, FlowerState.open),
    ])
    func petalsSpread(from: FlowerState, to: FlowerState) {
        let a = PetalPose.resting(from)
        let b = PetalPose.resting(to)
        #expect(a.centerOffset < b.centerOffset)
        #expect(a.radiusY < b.radiusY)
        #expect(a.radiusX < b.radiusX)
    }

    @Test("the opening breath stays between opening and open")
    func breath() {
        let breath = PetalPose.breathIn
        #expect(breath.radiusX > PetalPose.resting(.opening).radiusX)
        #expect(breath.radiusX <= PetalPose.resting(.open).radiusX)
    }

    @Test("five petals, evenly spaced")
    func petalAngles() {
        #expect(Flower.petalAngles == [0, 72, 144, 216, 288])
    }
}
