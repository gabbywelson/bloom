import XCTest

/// The signed-in flows against the in-process demo server (`-BloomDemo`):
/// the iOS counterpart of apps/web/e2e, minus the model.
final class DemoFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    private func launchDemo() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-BloomDemo"]
        app.launch()
        return app
    }

    @MainActor
    func testChatStreamsAReplyThatCreatesATask() {
        let app = launchDemo()
        XCTAssertTrue(app.staticTexts["Morning. Two small things on the list today."].waitForExistence(timeout: 10))

        let composer = app.textViews["composer-input"].exists ? app.textViews["composer-input"] : app.textFields["composer-input"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("Add water the ferns")
        app.buttons["composer-send"].tap()

        XCTAssertTrue(app.staticTexts["Add water the ferns"].waitForExistence(timeout: 5), "the user turn shows at once")
        XCTAssertTrue(app.staticTexts["Added “water the ferns”."].waitForExistence(timeout: 10), "the reply streams in")
        XCTAssertTrue(app.staticTexts["used create task"].exists, "the tool round is a quiet line")
        XCTAssertTrue(app.otherElements["bloom-thinking"].waitForNonExistence(timeout: 5), "the flower settles")

        // Sending puts the keyboard away; tasks_changed refreshed the list.
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        app.tabBars.buttons["Tasks"].tap()
        XCTAssertTrue(app.staticTexts["water the ferns"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testDoneTakesATaskOffTheList() {
        let app = launchDemo()
        app.tabBars.buttons["Tasks"].tap()
        let dentist = app.staticTexts["Call the dentist"]
        XCTAssertTrue(dentist.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Water the plants"].exists)

        app.buttons.matching(identifier: "task-done").firstMatch.tap()
        XCTAssertTrue(dentist.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Water the plants"].exists)
    }
}
