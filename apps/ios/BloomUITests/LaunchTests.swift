import XCTest

/// Smoke test: the app launches and shows Bloom's mark.
final class LaunchTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunchShowsTheFlower() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.images["bloom-flower"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Bloom"].exists)
    }
}
