import AppIntents
import BloomKit
import SwiftUI
import WidgetKit

/// Bloom's widget extension: the tasks widget and the capture control.
@main
struct BloomWidgets: WidgetBundle {
    var body: some Widget {
        TasksWidget()
        CaptureControl()
    }
}

/// A Control Center / Lock Screen button that opens Bloom ready to jot
/// something down (`bloom://capture`, handled by the app).
struct CaptureControl: ControlWidget {
    static let kind = "dev.bloom.capture-control"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "bloom://capture")!)) {
                Label("Capture to Bloom", systemImage: "tray.and.arrow.down")
            }
        }
        .displayName("Capture to Bloom")
        .description("Open Bloom ready to jot something down.")
    }
}
