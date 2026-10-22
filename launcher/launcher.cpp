/*
 * Local OJ Launcher
 * -----------------
 * A tiny, dependency-free Windows tray application (Win32 API only) that:
 *   1. Locates node.exe:
 *        - OJ_NODE environment variable
 *        - local_oj.json config file (in the launcher's directory)
 *        - PATH search
 *        - WorkBuddy-managed node: %USERPROFILE%\.workbuddy\binaries\node\versions\<ver>\node.exe
 *        - nvm:                  %USERPROFILE%\AppData\Roaming\nvm\<ver>\node.exe
 *                                 %USERPROFILE%\.nvm\<ver>\node.exe
 *        - common install dirs:  C:\Program Files\nodejs\node.exe  (x86 too)
 *      If nothing is found, a file-picker dialog lets the user choose node.exe
 *      once; the choice is saved to local_oj.json for next time.
 *   2. Launches `node server.js` from the launcher's own directory as a
 *      hidden background process, placed inside a Job Object so the whole
 *      process tree is killed on exit.
 *   3. Shows a system-tray icon. Right-click (or left-click) opens a menu:
 *        - 打开网页  (open http://localhost:<port> in the default browser)
 *        - 退出服务  (terminate node + quit)
 *
 * Build (MinGW-w64): see build.bat / build.sh.
 */
#include <windows.h>
#include <shellapi.h>
#include <commdlg.h>
#include <tlhelp32.h>
#include <string>
#include <vector>

#define WM_TRAYICON   (WM_USER + 1)
#define WM_NODEDIED   (WM_USER + 2)
#define IDM_OPEN      1001
#define IDM_EXIT      1002
#define APP_ICON_ID   101
#define SINGLETON     L"LocalOJLauncherSingleton_v1"

static HINSTANCE g_hinst = NULL;
static HWND      g_hwnd  = NULL;
static NOTIFYICONDATAW g_nid = { 0 };
static HANDLE    g_hJob      = NULL;
static HANDLE    g_hProcess  = NULL;
static bool      g_external  = false;   // true if a server was already running
static int       g_port     = 8080;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
static bool FileExists(const wchar_t* p) {
    DWORD a = GetFileAttributesW(p);
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

static std::wstring GetExeDir() {
    wchar_t buf[MAX_PATH] = { 0 };
    GetModuleFileNameW(NULL, buf, MAX_PATH);
    std::wstring s(buf);
    size_t pos = s.find_last_of(L"\\/");
    if (pos != std::wstring::npos) s = s.substr(0, pos);
    return s;
}

static int GetPort() {
    wchar_t b[32] = { 0 };
    if (GetEnvironmentVariableW(L"OJ_PORT", b, 32) > 0) {
        int p = _wtoi(b);
        if (p > 0) return p;
    }
    return 8080;
}

// Read the optional "node" path from local_oj.json (in the exe directory).
static std::wstring ReadConfigNode() {
    std::wstring path = GetExeDir() + L"\\local_oj.json";
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, NULL,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return L"";
    DWORD sz = GetFileSize(h, NULL);
    std::string buf;
    if (sz > 0 && sz < 65536) {
        buf.resize(sz);
        DWORD rd = 0;
        ReadFile(h, &buf[0], sz, &rd, NULL);
    }
    CloseHandle(h);
    if (buf.empty()) return L"";
    int wlen = MultiByteToWideChar(CP_UTF8, 0, buf.data(), (int)buf.size(), NULL, 0);
    if (wlen <= 0) return L"";
    std::wstring w(wlen, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, buf.data(), (int)buf.size(), &w[0], wlen);
    // naive extraction of  "node" : "...."
    std::wstring key = L"\"node\"";
    size_t p = w.find(key);
    if (p == std::wstring::npos) return L"";
    p = w.find(L'"', p + key.size());
    if (p == std::wstring::npos) return L"";
    p++;
    size_t q = w.find(L'"', p);
    if (q == std::wstring::npos) return L"";
    std::wstring val = w.substr(p, q - p);
    std::wstring out;
    for (size_t i = 0; i < val.size(); ++i) {
        if (val[i] == L'\\' && i + 1 < val.size()) { out += val[i + 1]; ++i; }
        else out += val[i];
    }
    return out;
}

// Persist the chosen node path into local_oj.json for next launch.
static void WriteConfigNode(const std::wstring& nodePath) {
    std::wstring path = GetExeDir() + L"\\local_oj.json";
    std::wstring content = L"{\n  \"node\": \"";
    for (wchar_t c : nodePath) {
        if (c == L'\\') content += L"\\\\";
        else content += c;
    }
    content += L"\"\n}\n";
    int len = WideCharToMultiByte(CP_UTF8, 0, content.c_str(), (int)content.size(),
                                  NULL, 0, NULL, NULL);
    if (len <= 0) return;
    std::string buf(len, '\0');
    WideCharToMultiByte(CP_UTF8, 0, content.c_str(), (int)content.size(),
                        &buf[0], len, NULL, NULL);
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, NULL);
    if (h != INVALID_HANDLE_VALUE) {
        DWORD wr = 0;
        WriteFile(h, buf.data(), (DWORD)buf.size(), &wr, NULL);
        CloseHandle(h);
    }
}

// Look for <dir>\<version-subfolder>\node.exe and return the first match.
static std::wstring FindNodeInVersionDir(const std::wstring& dir) {
    std::wstring search = dir + L"\\*";
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW(search.c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return L"";
    std::wstring found;
    do {
        if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
        if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
        std::wstring cand = dir + L"\\" + fd.cFileName + L"\\node.exe";
        if (FileExists(cand.c_str())) { found = cand; break; }
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    return found;
}

static std::wstring FindNode() {
    // 1. explicit env override
    wchar_t env[1024] = { 0 };
    if (GetEnvironmentVariableW(L"OJ_NODE", env, 1024) > 0) {
        if (FileExists(env)) return env;
    }
    // 2. local_oj.json config (in the launcher's directory)
    std::wstring cfg = ReadConfigNode();
    if (!cfg.empty() && FileExists(cfg.c_str())) return cfg;
    // 3. PATH search for node.exe
    wchar_t pathEnv[32767] = { 0 };
    if (GetEnvironmentVariableW(L"PATH", pathEnv, 32767) > 0) {
        std::wstring pathStr(pathEnv);
        size_t start = 0;
        while (start < pathStr.size()) {
            size_t end = pathStr.find_first_of(L";", start);
            std::wstring d = pathStr.substr(start, end - start);
            if (!d.empty() && d.back() != L'\\') d += L"\\";
            d += L"node.exe";
            if (FileExists(d.c_str())) return d;
            if (end == std::wstring::npos) break;
            start = end + 1;
        }
    }
    // 4. WorkBuddy-managed node
    wchar_t prof[1024] = { 0 };
    if (GetEnvironmentVariableW(L"USERPROFILE", prof, 1024) > 0) {
        std::wstring wb = std::wstring(prof) +
            L"\\.workbuddy\\binaries\\node\\versions";
        std::wstring found = FindNodeInVersionDir(wb);
        if (!found.empty()) return found;
    }
    // 5. nvm (common install locations)
    if (GetEnvironmentVariableW(L"USERPROFILE", prof, 1024) > 0) {
        std::wstring nvm1 = std::wstring(prof) + L"\\AppData\\Roaming\\nvm";
        std::wstring found = FindNodeInVersionDir(nvm1);
        if (!found.empty()) return found;
        std::wstring nvm2 = std::wstring(prof) + L"\\.nvm";
        found = FindNodeInVersionDir(nvm2);
        if (!found.empty()) return found;
    }
    // 6. fixed common install locations
    const wchar_t* common[] = {
        L"C:\\Program Files\\nodejs\\node.exe",
        L"C:\\Program Files (x86)\\nodejs\\node.exe",
        NULL
    };
    for (int i = 0; common[i]; ++i) {
        if (FileExists(common[i])) return common[i];
    }
    return L"";
}

// Let the user pick node.exe manually (used when auto-detection fails).
static std::wstring PickNode(HWND owner) {
    wchar_t buf[MAX_PATH] = { 0 };
    OPENFILENAMEW ofn = { 0 };
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner   = owner;
    ofn.lpstrFilter = L"Node.js 可执行文件 (*.exe)\0node.exe\0所有文件 (*.*)\0*.*\0\0";
    ofn.lpstrFile   = buf;
    ofn.nMaxFile    = MAX_PATH;
    ofn.Flags       = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_EXPLORER;
    ofn.lpstrTitle  = L"请选择 node.exe（Node.js 可执行文件）";
    ofn.nFilterIndex = 1;
    if (GetOpenFileNameW(&ofn)) return std::wstring(buf);
    return L"";
}

// Probe whether something is already listening on 127.0.0.1:<port>.
static bool PortInUse() {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
    SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
    if (s == INVALID_SOCKET) { WSACleanup(); return false; }
    struct sockaddr_in a;
    memset(&a, 0, sizeof(a));
    a.sin_family = AF_INET;
    a.sin_port   = htons((u_short)g_port);
    a.sin_addr.s_addr = inet_addr("127.0.0.1");
    bool inuse = (connect(s, (struct sockaddr*)&a, sizeof(a)) == 0);
    closesocket(s);
    WSACleanup();
    return inuse;
}

static bool LaunchServer(const std::wstring& nodePath, const std::wstring& cwd) {
    g_hJob = CreateJobObjectW(NULL, NULL);
    if (g_hJob) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = { 0 };
        jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(g_hJob, JobObjectExtendedLimitInformation,
                               &jeli, sizeof(jeli));
    }

    std::wstring cmd = L"\"" + nodePath + L"\" server.js";
    STARTUPINFOW si = { 0 };
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi = { 0 };
    if (!CreateProcessW(nodePath.c_str(), (LPWSTR)cmd.c_str(), NULL, NULL, FALSE,
                        CREATE_NO_WINDOW | CREATE_SUSPENDED, NULL,
                        cwd.c_str(), &si, &pi)) {
        return false;
    }
    if (g_hJob) AssignProcessToJobObject(g_hJob, pi.hProcess);
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    g_hProcess = pi.hProcess;
    return true;
}

static DWORD WINAPI WaitThread(LPVOID) {
    if (g_hProcess) WaitForSingleObject(g_hProcess, INFINITE);
    PostMessageW(g_hwnd, WM_NODEDIED, 0, 0);
    return 0;
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
static void AddTray() {
    g_nid.cbSize = sizeof(NOTIFYICONDATAW);
    g_nid.hWnd   = g_hwnd;
    g_nid.uID    = 1;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_nid.uCallbackMessage = WM_TRAYICON;
    g_nid.hIcon = LoadIconA(g_hinst, MAKEINTRESOURCE(APP_ICON_ID));
    if (!g_nid.hIcon) g_nid.hIcon = LoadIconA(NULL, IDI_APPLICATION);
    wcsncpy(g_nid.szTip, L"Local OJ", 127);
    g_nid.szTip[127] = 0;
    Shell_NotifyIconW(NIM_ADD, &g_nid);
}

static void RemoveTray() {
    Shell_NotifyIconW(NIM_DELETE, &g_nid);
}

static void ShowBalloon(const wchar_t* title, const wchar_t* msg) {
    g_nid.uFlags |= NIF_INFO;
    wcsncpy(g_nid.szInfo, msg, 255);
    g_nid.szInfo[255] = 0;
    wcsncpy(g_nid.szInfoTitle, title, 63);
    g_nid.szInfoTitle[63] = 0;
    g_nid.dwInfoFlags = NIIF_INFO;
    g_nid.uTimeout = 4000;
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
}

static void ShowMenu() {
    POINT pt;
    GetCursorPos(&pt);
    HMENU menu = CreatePopupMenu();
    AppendMenuW(menu, MF_STRING, IDM_OPEN, L"打开网页");
    AppendMenuW(menu, MF_SEPARATOR, 0, NULL);
    AppendMenuW(menu, MF_STRING, IDM_EXIT, L"退出服务");
    SetForegroundWindow(g_hwnd);
    TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_BOTTOMALIGN | TPM_LEFTALIGN,
                   pt.x, pt.y, 0, g_hwnd, NULL);
    DestroyMenu(menu);
}

static void OpenBrowser() {
    std::wstring url = L"http://localhost:" + std::to_wstring(g_port) + L"/";
    ShellExecuteW(NULL, L"open", url.c_str(), NULL, NULL, SW_SHOWNORMAL);
}

// Explicitly terminate a process and its entire descendant tree.
// Used so "退出服务" reliably stops node even when the launcher itself is
// running inside another Job (some shells/sandboxes auto-add children to a
// parent Job, which prevents our own Job assignment from taking effect).
static void KillProcessTree(DWORD root) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return;
    std::vector<DWORD> toKill;
    std::vector<DWORD> frontier;
    frontier.push_back(root);
    PROCESSENTRY32 pe;
    pe.dwSize = sizeof(pe);
    while (!frontier.empty()) {
        DWORD cur = frontier.back();
        frontier.pop_back();
        toKill.push_back(cur);
        if (Process32First(snap, &pe)) {
            do {
                if (pe.th32ParentProcessID == cur)
                    frontier.push_back(pe.th32ProcessID);
            } while (Process32Next(snap, &pe));
        }
    }
    CloseHandle(snap);
    // Kill deepest descendants first (toKill is BFS order: parent before child).
    for (auto it = toKill.rbegin(); it != toKill.rend(); ++it) {
        HANDLE h = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION,
                               FALSE, *it);
        if (h) { TerminateProcess(h, 0); CloseHandle(h); }
    }
}

static void Shutdown() {
    RemoveTray();
    if (!g_external) {
        if (g_hProcess) {
            KillProcessTree(GetProcessId(g_hProcess));
            CloseHandle(g_hProcess);
            g_hProcess = NULL;
        }
        // Best-effort: also nuke the Job (works when the launcher is not itself
        // already inside another Job, i.e. the normal double-click case).
        if (g_hJob) {
            TerminateJobObject(g_hJob, 0);
            CloseHandle(g_hJob);
            g_hJob = NULL;
        }
    }
    PostQuitMessage(0);
}

// ---------------------------------------------------------------------------
// Window procedure
// ---------------------------------------------------------------------------
static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_TRAYICON:
            if (lp == WM_RBUTTONUP || lp == WM_LBUTTONUP || lp == WM_CONTEXTMENU) {
                ShowMenu();
            }
            break;
        case WM_COMMAND:
            if (LOWORD(wp) == IDM_EXIT)      Shutdown();
            else if (LOWORD(wp) == IDM_OPEN) OpenBrowser();
            break;
        case WM_NODEDIED:
            if (!g_external) {
                ShowBalloon(L"Local OJ 已停止",
                            L"node 服务进程已退出（可能端口被占用或发生错误）。");
            }
            break;
        case WM_DESTROY:
            PostQuitMessage(0);
            break;
        default:
            return DefWindowProcW(hwnd, msg, wp, lp);
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
int WINAPI WinMain(HINSTANCE hinst, HINSTANCE, LPSTR, int) {
    g_hinst = hinst;
    g_port  = GetPort();

    // Single-instance guard so we don't stack multiple trays.
    HANDLE mutex = CreateMutexW(NULL, TRUE, SINGLETON);
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        MessageBoxW(NULL, L"Local OJ 启动器已在运行。", L"Local OJ",
                    MB_OK | MB_ICONINFORMATION);
        return 0;
    }

    WNDCLASSW wc = { 0 };
    wc.lpfnWndProc = WndProc;
    wc.hInstance   = hinst;
    wc.lpszClassName = L"LocalOJLauncherClass";
    if (!RegisterClassW(&wc)) return 1;

    g_hwnd = CreateWindowExW(0, wc.lpszClassName, L"LocalOJ", 0,
                             0, 0, 0, 0, HWND_MESSAGE, NULL, hinst, NULL);
    if (!g_hwnd) return 1;

    std::wstring dir  = GetExeDir();
    std::wstring node = FindNode();
    if (node.empty()) {
        // Auto-detection failed: ask the user to point at node.exe once.
        int ans = MessageBoxW(NULL,
            L"未能自动找到 node.exe。\nNode.js 是运行本服务的必备环境。\n\n"
            L"点击「确定」在弹出的对话框中选择 node.exe（选择后会自动记住）；\n"
            L"点击「取消」退出。",
            L"Local OJ", MB_OKCANCEL | MB_ICONINFORMATION);
        if (ans != IDOK) return 0;
        node = PickNode(g_hwnd);
        if (node.empty()) {
            MessageBoxW(NULL, L"未选择 node.exe，启动已取消。",
                        L"Local OJ", MB_OK | MB_ICONERROR);
            return 0;
        }
        WriteConfigNode(node);
    }

    if (PortInUse()) {
        g_external = true;
        ShowBalloon(L"Local OJ 已在运行",
                    L"检测到端口已有服务。点击「打开网页」即可访问。");
    } else {
        if (!LaunchServer(node, dir)) {
            MessageBoxW(NULL,
                        L"无法启动 node 服务，请确认 server.js 与本启动器位于同一目录。",
                        L"Local OJ", MB_OK | MB_ICONERROR);
            return 1;
        }
        CloseHandle(CreateThread(NULL, 0, WaitThread, NULL, 0, NULL));
        ShowBalloon(L"Local OJ 已启动",
                    L"右键点击托盘图标可「打开网页」或「退出服务」。");
    }

    AddTray();

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
