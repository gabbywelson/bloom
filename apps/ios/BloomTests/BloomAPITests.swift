import BloomKit
import Foundation
import HTTPTypes
import Testing

/// The facade over the generated client, against a fake transport.
@Suite("Bloom API client")
struct BloomAPITests {
    static let server = URL(string: "http://bloom.test")!

    static let taskJSON = """
        {"id":"019a0000-0000-7000-8000-0000000000c3","title":"Water the ferns","notes":null,
         "status":"next","due":"2026-10-06T17:00:00.000Z","scheduledFor":null,"effort":1,
         "energyKind":"physical","area":"Home","source":"agent","parentId":null,"completedAt":null,
         "createdAt":"2026-10-05T07:30:00.000Z","updatedAt":"2026-10-05T07:30:00.000Z"}
        """

    private func api(_ transport: FakeTransport, token: String? = "tok_123") -> BloomAPI {
        BloomAPI(serverURL: Self.server, tokens: StaticTokenProvider(token), transport: transport)
    }

    @Test("sends the bearer token and the status filter as repeated query items")
    func tasksRequest() async throws {
        let transport = FakeTransport(FakeTransport.json("[\(Self.taskJSON)]"))
        let tasks = try await api(transport).tasks(status: [.inbox, .next])

        let request = try #require(transport.requests.first?.request)
        #expect(request.method == .get)
        #expect(request.path == "/api/tasks?status=inbox&status=next")
        #expect(request.headerFields[.authorization] == "Bearer tok_123")

        let task = try #require(tasks.first)
        #expect(task.title == "Water the ferns")
        #expect(task.status == .next)
        #expect(task.effort == 1)
        #expect(task.energyKind == .physical)
        #expect(task.notes == nil)
        #expect(task.dueDate == BloomDate.parse("2026-10-06T17:00:00Z"))
    }

    @Test("without a token no Authorization header is sent")
    func noToken() async throws {
        let transport = FakeTransport(FakeTransport.json(#"{"status":"ok","service":"bloom-server","time":"2026-10-05T07:30:00.000Z"}"#))
        let health = try await api(transport, token: nil).health()
        #expect(health.service == .bloomServer)
        #expect(transport.requests.first?.request.headerFields[.authorization] == nil)
    }

    @Test("401 becomes .unauthorized")
    func unauthorized() async throws {
        let transport = FakeTransport(FakeTransport.json(#"{"_tag":"Unauthorized","message":"Please sign in."}"#, status: .unauthorized))
        await #expect(throws: BloomAPIError.unauthorized) {
            _ = try await api(transport).mainThread()
        }
    }

    @Test("404 on complete becomes .notFound; undocumented 400 becomes .badRequest")
    func statuses() async throws {
        let notFound = FakeTransport(FakeTransport.json(#"{"_tag":"TaskNotFound","id":"x"}"#, status: .notFound))
        await #expect(throws: BloomAPIError.notFound) {
            _ = try await api(notFound).completeTask(id: "x")
        }
        let bad = FakeTransport { _ in (.badRequest, "application/json", "") }
        await #expect(throws: BloomAPIError.badRequest) {
            _ = try await api(bad).createTask(.init(title: "x"))
        }
    }

    @Test("create sends only the fields that are set")
    func createPayload() async throws {
        let transport = FakeTransport(FakeTransport.json(Self.taskJSON))
        _ = try await api(transport).createTask(.init(title: "Water the ferns"))
        let recorded = try #require(transport.requests.first)
        #expect(recorded.request.method == .post)
        #expect(recorded.request.path == "/api/tasks")
        let body = try #require(recorded.body?.data(using: .utf8))
        let object = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(object.keys.sorted() == ["title"])
    }

    @Test("messages passes limit as the numeric string the contract expects")
    func messagesLimit() async throws {
        let transport = FakeTransport(FakeTransport.json("[]"))
        let messages = try await api(transport).messages(threadId: "t-1", limit: 40)
        #expect(messages.isEmpty)
        #expect(transport.requests.first?.request.path == "/api/threads/t-1/messages?limit=40")
    }

    @Test("send streams the reply events from the SSE body")
    func send() async throws {
        let sse = try #require(String(data: Fixtures.chatStream("tool-round"), encoding: .utf8))
        let transport = FakeTransport { _ in (.ok, "text/event-stream", sse) }
        var count = 0
        for try await _ in try await api(transport).send(threadId: "t-1", text: "Add ferns") {
            count += 1
        }
        #expect(count == 7)
        let recorded = try #require(transport.requests.first)
        #expect(recorded.request.path == "/api/threads/t-1/messages")
        let body = try #require(recorded.body?.data(using: .utf8))
        #expect(try JSONSerialization.jsonObject(with: body) as? [String: String] == ["text": "Add ferns"])
    }

    @Test("a dropped connection is .unreachable")
    func transportFailure() async throws {
        let api = BloomAPI(serverURL: Self.server, tokens: StaticTokenProvider(nil), transport: OfflineTransport())
        await #expect(throws: BloomAPIError.unreachable) {
            _ = try await api.health()
        }
    }
}

