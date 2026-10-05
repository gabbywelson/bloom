import BloomKit
import SwiftUI

/// One turn: a bubble with its parts and a quiet timestamp underneath.
struct MessageRow: View {
    let message: ChatMessage
    /// A reply is streaming: generative-UI controls that reply to Bloom are disabled.
    let busy: Bool

    private var isUser: Bool { message.role == .user }

    var body: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: BloomSpacing.s1) {
            VStack(alignment: .leading, spacing: BloomSpacing.s2) {
                ForEach(Array(visibleParts.enumerated()), id: \.offset) { _, part in
                    PartView(part: part, busy: busy)
                }
            }
            .padding(.vertical, BloomSpacing.s3)
            .padding(.horizontal, BloomSpacing.s4)
            .background(bubble)
            Text(DateLabels.time(message.createdAt))
                .font(.caption2)
                .foregroundStyle(BloomPalette.inkFaint)
                .padding(.horizontal, BloomSpacing.s2)
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        .padding(isUser ? .leading : .trailing, BloomSpacing.s7)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("message-\(message.role.rawValue)")
    }

    /// A tool call that already has its result shows as one "used …" line.
    private var visibleParts: [BloomMessagePart] {
        let finished = Set(message.parts.compactMap { part -> String? in
            if case let .toolResult(result) = part { result.toolCallId } else { nil }
        })
        return message.parts.filter { part in
            if case let .toolCall(call) = part { !finished.contains(call.id) } else { true }
        }
    }

    @ViewBuilder private var bubble: some View {
        let shape = RoundedRectangle(cornerRadius: BloomSpacing.radius, style: .continuous)
        switch message.role {
        case .user:
            shape.fill(BloomPalette.sageSoft)
        case .assistant:
            shape.fill(BloomPalette.surface).overlay(shape.strokeBorder(BloomPalette.border))
        case .system, .tool:
            shape.strokeBorder(BloomPalette.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        }
    }
}

/// One message part.
private struct PartView: View {
    let part: BloomMessagePart
    let busy: Bool

    var body: some View {
        switch part {
        case let .text(text):
            Text(markdown(text.text))
                .foregroundStyle(BloomPalette.ink)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        case let .image(image):
            AsyncImage(url: URL(string: image.url)) { loaded in
                loaded.resizable().scaledToFit()
            } placeholder: {
                BloomPalette.surfaceMuted.frame(height: 120)
            }
            .clipShape(RoundedRectangle(cornerRadius: BloomSpacing.radiusSmall))
            .accessibilityLabel(image.alt ?? "Image")
        case let .toolCall(call):
            ToolLine(text: "using \(toolLabel(call.name))")
        case let .toolResult(result):
            ToolLine(text: result.ok ? "used \(toolLabel(result.name))" : "couldn't finish \(toolLabel(result.name))")
        case let .uiComponent(ui):
            UiComponentView(component: ui.component, busy: busy)
        }
    }

    private func toolLabel(_ name: String) -> String { name.replacingOccurrences(of: "_", with: " ") }

    /// Inline Markdown (bold, italics, links, code) with line breaks kept.
    private func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(text)
    }
}

/// The web's quiet italic "used create task" line.
private struct ToolLine: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote.italic())
            .foregroundStyle(BloomPalette.inkMuted)
            .accessibilityIdentifier("tool-line")
    }
}
