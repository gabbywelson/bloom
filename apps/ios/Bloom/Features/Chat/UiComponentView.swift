import BloomKit
import SwiftUI

/// Generative UI parts, rendered natively (ADR 0016's rules): a task card's
/// "Done" acts through the tasks API because completing a task is the user's
/// own action; every other choice goes back to Bloom as the user's reply, so
/// nothing consequential runs without the agent. A choice is shown as made
/// only once it went through, so a dropped one can be retried.
struct UiComponentView: View {
    let component: BloomUiComponent
    let busy: Bool

    @Environment(Workspace.self) private var workspace
    @State private var chosen: String?

    var body: some View {
        switch component {
        case let .taskCard(card):
            TaskCardView(card: card)
        case let .optionPicker(picker):
            Choices(prompt: picker.prompt, chosen: chosen) {
                ForEach(picker.options, id: \.id) { option in
                    choiceButton(option.label, id: option.id) { await workspace.chat.send(option.label) }
                }
            }
        case let .confirm(confirm):
            Choices(prompt: confirm.prompt, chosen: chosen) {
                choiceButton(confirm.confirmLabel, id: "confirm", primary: true) {
                    await workspace.chat.send(confirm.confirmLabel)
                }
                choiceButton(confirm.cancelLabel, id: "cancel") { await workspace.chat.send(confirm.cancelLabel) }
            }
        case let .snoozePicker(picker):
            Choices(prompt: picker.prompt, chosen: chosen) {
                ForEach(picker.choices, id: \.id) { choice in
                    choiceButton(choice.label, id: choice.id) {
                        await workspace.chat.send("Snooze it until \(choice.label.lowercased()).")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func choiceButton(
        _ label: String,
        id: String,
        primary: Bool = false,
        action: @escaping () async -> Bool
    ) -> some View {
        let button = Button(label) {
            Task { if await action() { chosen = id } }
        }
        .disabled(busy || chosen != nil)
        if primary { button.buttonStyle(.bloomPrimary) } else { button.buttonStyle(.bloomQuiet) }
    }
}

/// Prompt plus a wrapping row of choices.
private struct Choices<Content: View>: View {
    let prompt: String
    let chosen: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: BloomSpacing.s2) {
            Text(prompt)
                .foregroundStyle(BloomPalette.ink)
            FlowRow { content }
            if chosen != nil {
                Text("Sent")
                    .font(.caption)
                    .foregroundStyle(BloomPalette.inkMuted)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// Lays children out left to right, wrapping onto new lines.
private struct FlowRow: Layout {
    var spacing: CGFloat = BloomSpacing.s2

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(widest, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Inline card for a task Bloom mentioned: title, status, due, and "Done".
struct TaskCardView: View {
    let card: Components.Schemas.TaskCard

    @Environment(Workspace.self) private var workspace
    @State private var done = false

    private var isDone: Bool { done || card.status == .done }

    var body: some View {
        VStack(alignment: .leading, spacing: BloomSpacing.s2) {
            HStack(alignment: .firstTextBaseline) {
                Text(card.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(BloomPalette.ink)
                    .strikethrough(isDone, color: BloomPalette.inkFaint)
                Spacer(minLength: BloomSpacing.s2)
                StatusChip(status: isDone ? .done : card.status)
            }
            HStack {
                if let due = card.due.flatMap(BloomDate.parse) {
                    Text("Due \(DateLabels.due(due))")
                        .font(.footnote)
                        .foregroundStyle(BloomPalette.inkMuted)
                }
                Spacer()
                if !isDone {
                    Button(workspace.tasks.completing == card.taskId ? "Saving" : "Done") {
                        Task { done = await workspace.tasks.complete(card.taskId) }
                    }
                    .buttonStyle(.bloomQuiet)
                    .disabled(workspace.tasks.completing != nil)
                }
            }
        }
        .padding(BloomSpacing.s3)
        .background(BloomPalette.page, in: RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall))
        .overlay(RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall).strokeBorder(BloomPalette.border))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("task-card")
    }
}

/// The web's status chip.
struct StatusChip: View {
    let status: BloomTaskStatus

    var body: some View {
        Text(status.label)
            .font(.caption.weight(.medium))
            .padding(.vertical, 2)
            .padding(.horizontal, BloomSpacing.s2)
            .foregroundStyle(status == .next ? BloomPalette.accent : BloomPalette.inkMuted)
            .background(Capsule().fill(status == .next ? BloomPalette.accent.opacity(0.12) : BloomPalette.surfaceMuted))
    }
}
