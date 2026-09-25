import SwiftUI
import UniformTypeIdentifiers

struct BridgeDevice: Decodable, Identifiable {
    let id: String
    let platform: String
    let name: String?
    let state: String?
    let error: String?
}

struct BridgeAccount: Decodable, Identifiable {
    let id: String
    let name: String
    let deviceId: String
    let appId: String
    let platform: String
}

struct BridgeMedia: Decodable, Identifiable {
    let id: String
    let name: String
    let size: Int
}

struct BridgeReel: Decodable, Identifiable {
    let id: String
    let accountId: String
    let mediaId: String
    let caption: String
    let status: String
    let scheduledAt: String?
    let lastError: String?
}

enum BridgeError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let text) = self { return text }
        return nil
    }
}

@MainActor
final class BridgeModel: ObservableObject {
    @Published var devices: [BridgeDevice] = []
    @Published var accounts: [BridgeAccount] = []
    @Published var media: [BridgeMedia] = []
    @Published var reels: [BridgeReel] = []
    @Published var status = "Starting the device bridge…"
    @Published var errorText = ""
    @Published var busy = false

    private var backend: Process?
    private var started = false
    private var baseURL: URL?
    private let token = UUID().uuidString + UUID().uuidString

    func start() {
        guard !started else { return }
        started = true
        Task { await launch() }
    }

    func stop() {
        if backend?.isRunning == true { backend?.terminate() }
        backend = nil
        started = false
        baseURL = nil
    }

    private func launch() async {
        do {
            let resources = Bundle.main.resourceURL!
            let node = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/node")
            let root = resources.appendingPathComponent("farmbridge")
            guard FileManager.default.isExecutableFile(atPath: node.path),
                  FileManager.default.fileExists(atPath: root.appendingPathComponent("src/index.js").path) else {
                throw BridgeError.message("The bundled device bridge is missing. Download a complete FarmBridge app build.")
            }
            let port = Int.random(in: 22000...49000)
            let logDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/FarmBridge")
            try FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
            let logURL = logDir.appendingPathComponent("bridge.log")
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil)
            }
            let log = try FileHandle(forWritingTo: logURL)
            try log.seekToEnd()
            let process = Process()
            process.executableURL = node
            process.arguments = ["src/index.js"]
            process.currentDirectoryURL = root
            process.standardOutput = log
            process.standardError = log
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (environment["PATH"] ?? "")
            environment["HOST"] = "127.0.0.1"
            environment["PORT"] = String(port)
            environment["FARMBRIDGE_API_TOKEN"] = token
            process.environment = environment
            try process.run()
            backend = process
            baseURL = URL(string: "http://127.0.0.1:\(port)")
            for _ in 0..<50 {
                if !process.isRunning { break }
                if (try? await request("/api/health")) != nil {
                    status = "Ready · device bridge running locally"
                    await refresh()
                    return
                }
                try await Task.sleep(nanoseconds: 200_000_000)
            }
            throw BridgeError.message("The device bridge could not start. See ~/Library/Logs/FarmBridge/bridge.log.")
        } catch {
            status = "Bridge unavailable"
            errorText = error.localizedDescription
            stop()
        }
    }

    private func request(_ route: String, method: String = "GET", body: [String: Any]? = nil) async throws -> [String: Any] {
        guard let baseURL else { throw BridgeError.message("The device bridge is starting. Please try again.") }
        var request = URLRequest(url: baseURL.appendingPathComponent(route.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw BridgeError.message(object["error"] as? String ?? "The device bridge returned an error.")
        }
        return object
    }

    private func list<T: Decodable>(_ route: String, key: String, as type: T.Type) async throws -> [T] {
        let object = try await request(route)
        let data = try JSONSerialization.data(withJSONObject: object[key] ?? [])
        return try JSONDecoder().decode([T].self, from: data)
    }

    func refresh() async {
        do {
            devices = try await list("/api/devices", key: "devices", as: BridgeDevice.self)
            accounts = try await list("/api/accounts", key: "accounts", as: BridgeAccount.self)
            media = try await list("/api/media", key: "media", as: BridgeMedia.self)
            reels = try await list("/api/reels", key: "reels", as: BridgeReel.self)
        } catch { errorText = error.localizedDescription }
    }

    private func perform(_ operation: () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do { try await operation(); await refresh() }
        catch { errorText = error.localizedDescription }
    }

    func uploadMedia(_ file: URL) async {
        await perform {
            guard let baseURL else { throw BridgeError.message("The device bridge is starting.") }
            var components = URLComponents(url: baseURL.appendingPathComponent("api/media/upload"), resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "name", value: file.lastPathComponent)]
            var request = URLRequest(url: components.url!)
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            let (data, response) = try await URLSession.shared.upload(for: request, fromFile: file)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                throw BridgeError.message(object?["error"] as? String ?? "Video upload failed.")
            }
        }
    }

    func addAccount(name: String, deviceId: String, appId: String) async {
        await perform { _ = try await request("/api/accounts", method: "POST", body: ["name": name, "deviceId": deviceId, "appId": appId]) }
    }

    func addReel(accountId: String, mediaId: String, caption: String, scheduledAt: Date?) async {
        await perform {
            var body: [String: Any] = ["accountId": accountId, "mediaId": mediaId, "caption": caption]
            if let scheduledAt { body["scheduledAt"] = ISO8601DateFormatter().string(from: scheduledAt) }
            _ = try await request("/api/reels", method: "POST", body: body)
        }
    }

    func prepare(_ reel: BridgeReel) async {
        await perform { _ = try await request("/api/reels/\(reel.id)/prepare", method: "POST", body: [:]) }
    }

    func confirmIosImport(_ reel: BridgeReel) async {
        await perform { _ = try await request("/api/reels/\(reel.id)/confirm-ios-import", method: "POST", body: [:]) }
    }
}

enum StudioTab: String, CaseIterable, Identifiable {
    case reels = "Reels", videos = "Videos", profiles = "Profiles", devices = "Devices"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .reels: return "play.rectangle.on.rectangle"
        case .videos: return "film"
        case .profiles: return "person.2"
        case .devices: return "iphone.gen3"
        }
    }
}

struct StudioView: View {
    @EnvironmentObject private var model: BridgeModel
    @State private var tab: StudioTab? = .reels
    @State private var showImporter = false
    @State private var profileName = ""
    @State private var deviceId = ""
    @State private var appId = "com.facebook.katana"
    @State private var accountId = ""
    @State private var mediaId = ""
    @State private var caption = ""
    @State private var schedule = false
    @State private var scheduleDate = Date().addingTimeInterval(3600)

    var body: some View {
        NavigationSplitView {
            List(StudioTab.allCases, selection: $tab) { item in
                Label(item.rawValue, systemImage: item.icon).tag(item)
            }
            .navigationTitle("FarmBridge")
            .frame(minWidth: 180)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(tab?.rawValue ?? "Reels").font(.largeTitle.bold())
                            Text(model.status).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if model.busy { ProgressView() }
                        Button("Refresh") { Task { await model.refresh() } }
                    }
                    switch tab ?? .reels {
                    case .reels: reelsView
                    case .videos: videosView
                    case .profiles: profilesView
                    case .devices: devicesView
                    }
                }
                .padding(24)
                .frame(maxWidth: 900, alignment: .leading)
            }
        }
        .frame(minWidth: 950, minHeight: 650)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .alert("FarmBridge", isPresented: Binding(get: { !model.errorText.isEmpty }, set: { if !$0 { model.errorText = "" } })) {
            Button("OK") { model.errorText = "" }
        } message: { Text(model.errorText) }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.mpeg4Movie, .quickTimeMovie, .movie]) { result in
            switch result {
            case .success(let file):
                Task {
                    let access = file.startAccessingSecurityScopedResource()
                    defer { if access { file.stopAccessingSecurityScopedResource() } }
                    await model.uploadMedia(file)
                }
            case .failure(let error): model.errorText = error.localizedDescription
            }
        }
    }

    private var videosView: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your videos stay on this Mac. MP4, MOV, or M4V; up to 500 MB each.").foregroundStyle(.secondary)
            Button("Add video…") { showImporter = true }.disabled(model.busy)
            ForEach(model.media) { video in
                HStack { Image(systemName: "film"); Text(video.name); Spacer(); Text(String(format: "%.1f MB", Double(video.size) / 1_048_576)).foregroundStyle(.secondary) }
                    .padding().background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
            }
            if model.media.isEmpty { ContentUnavailableView("No videos yet", systemImage: "film") }
        }
    }

    private var profilesView: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Choose a device where you are already signed into Facebook. Passwords are never stored.").foregroundStyle(.secondary)
            TextField("Profile name", text: $profileName)
            Picker("Device", selection: $deviceId) {
                Text("Choose device").tag("")
                ForEach(model.devices.filter { $0.state != "unavailable" && $0.state != "unauthorized" }) { device in
                    Text("\(device.name ?? device.id) (\(device.platform))").tag(device.id)
                }
            }
            .onChange(of: deviceId) { value in appId = value.hasPrefix("ios:") ? "" : "com.facebook.katana" }
            TextField("App ID / iOS bundle ID", text: $appId)
            Button("Save profile") {
                Task { await model.addAccount(name: profileName, deviceId: deviceId, appId: appId); profileName = "" }
            }.disabled(profileName.isEmpty || deviceId.isEmpty || appId.isEmpty || model.busy)
            Divider()
            ForEach(model.accounts) { account in
                VStack(alignment: .leading, spacing: 4) {
                    Text(account.name).font(.headline)
                    Text("\(account.deviceId) · \(account.appId)").foregroundStyle(.secondary)
                }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var reelsView: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Prepare a video for posting. Ready means staged on the device; it does not mean published.").foregroundStyle(.secondary)
            GroupBox("New Reel") {
                VStack(alignment: .leading, spacing: 12) {
                    Picker("Profile", selection: $accountId) {
                        Text("Choose profile").tag("")
                        ForEach(model.accounts) { account in Text(account.name).tag(account.id) }
                    }
                    Picker("Video", selection: $mediaId) {
                        Text("Choose video").tag("")
                        ForEach(model.media) { video in Text(video.name).tag(video.id) }
                    }
                    TextField("Caption", text: $caption, axis: .vertical).lineLimit(3...6)
                    Toggle("Prepare later", isOn: $schedule)
                    if schedule { DatePicker("Time", selection: $scheduleDate, in: Date()..., displayedComponents: [.date, .hourAndMinute]) }
                    Button("Save Reel") {
                        Task {
                            await model.addReel(accountId: accountId, mediaId: mediaId, caption: caption, scheduledAt: schedule ? scheduleDate : nil)
                            caption = ""
                        }
                    }.disabled(accountId.isEmpty || mediaId.isEmpty || model.busy)
                }.padding(8)
            }
            ForEach(model.reels) { reel in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(model.media.first { $0.id == reel.mediaId }?.name ?? "Video unavailable").font(.headline)
                        Spacer()
                        Text(reel.status.replacingOccurrences(of: "_", with: " ").capitalized).foregroundStyle(reel.status == "failed" ? .red : .secondary)
                    }
                    Text(model.accounts.first { $0.id == reel.accountId }?.name ?? "Profile unavailable").foregroundStyle(.secondary)
                    if !reel.caption.isEmpty { Text(reel.caption) }
                    if let scheduledAt = reel.scheduledAt { Text("Scheduled: \(scheduledAt)").font(.caption).foregroundStyle(.secondary) }
                    if let error = reel.lastError { Text(error).foregroundStyle(.red) }
                    if ["draft", "scheduled", "failed"].contains(reel.status) {
                        Button("Prepare now") { Task { await model.prepare(reel) } }.disabled(model.busy)
                    } else if reel.status == "needs_ios_import" {
                        Button("Video imported into Photos — open app") { Task { await model.confirmIosImport(reel) } }.disabled(model.busy)
                    }
                }
                .padding().frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
            }
            if model.reels.isEmpty { ContentUnavailableView("No Reels yet", systemImage: "play.rectangle") }
        }
    }

    private var devicesView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Connect an Android phone with USB debugging, or an iPhone with Xcode and Appium configured.").foregroundStyle(.secondary)
            ForEach(model.devices) { device in
                VStack(alignment: .leading, spacing: 4) {
                    Text(device.name ?? device.id).font(.headline)
                    Text("\(device.platform.uppercased()) · \(device.id) · \(device.state ?? "unknown")").foregroundStyle(.secondary)
                    if let error = device.error { Text(error).foregroundStyle(.red) }
                }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}

@main
struct FarmBridgeDesktopApp: App {
    @StateObject private var model = BridgeModel()
    var body: some Scene {
        WindowGroup("FarmBridge") { StudioView().environmentObject(model) }
    }
}
