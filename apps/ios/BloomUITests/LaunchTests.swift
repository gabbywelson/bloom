import XCTest

/// First run: no session, so the app opens on sign-in.
final class LaunchTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    private func launchSignedOut() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-BloomResetSession"]
        app.launch()
        return app
    }

    @MainActor
    func testFirstRunShowsSignIn() {
        let app = launchSignedOut()
        XCTAssertTrue(app.images["bloom-flower"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Sign in with a link"].exists)
        XCTAssertTrue(app.textFields["signin-link"].exists)
        XCTAssertFalse(app.buttons["signin-submit"].isEnabled)
    }

    @MainActor
    func testSomethingThatIsNotALinkGetsACalmExplanation() {
        let app = launchSignedOut()
        let field = app.textFields["signin-link"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("hello")
        app.buttons["signin-submit"].tap()
        let error = app.staticTexts["signin-error"]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.label.contains("doesn't look like a Bloom sign-in link"))
    }
}
