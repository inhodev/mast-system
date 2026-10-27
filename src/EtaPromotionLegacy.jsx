import { isPromotionTarget, promotionSubmissionError } from "./utils/promotionAssignmentPolicy.js";
import { promotionIntervalDays, promotionCopyForSchool, promotionSchoolKey, schoolRotationHistory, isSchoolRotationDue } from "./utils/promotionSchoolRules.js";
import { useState, useEffect, useCallback, useRef } from "react";
import { LEGACY_MEMBER_FIELDS } from "./services/baseService.js";
import SecureProofImage from "./components/SecureProofImage.jsx";
import { supabase } from "./lib/supabase.js";
import { notifyPromotionTargets } from "./services/notificationService.js";
import mastLogo from "./assets/mast-logo.webp";
import promotionHeroImg from "./assets/promotion-hero.webp";
import cameraImg from "./assets/camera.webp";

var PROOF_BUCKET = "proofs";

var MISSION_BUCKET = "missions";
var assets = {
  hero: { megaphone: promotionHeroImg },
  icon: { camera: cameraImg }
};

function todayKST() {
  var now = new Date();
  var kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return kst.getFullYear() + "-" + String(kst.getMonth() + 1).padStart(2, "0") + "-" + String(kst.getDate()).padStart(2, "0");
}
function addDaysKST(date, days) {
  var d = new Date(date + "T00:00:00+09:00");
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function keyOf(m) { return m.name + "|" + m.gi + "|" + m.school; }
function memberLabel(m) { return m.name + "(" + m.gi + ", " + m.school + ")"; }
function dueIsoKST(date, time) {
  var t = time || "02:00";
  var base = new Date(date + "T00:00:00+09:00");
  var hour = parseInt(t.slice(0, 2), 10) || 0;
  if (hour < 6) base.setDate(base.getDate() + 1);
  var y = base.getFullYear();
  var m = String(base.getMonth() + 1).padStart(2, "0");
  var d = String(base.getDate()).padStart(2, "0");
  return new Date(y + "-" + m + "-" + d + "T" + t + ":00+09:00").toISOString();
}
function exactIsoKST(date, time) {
  return new Date(date + "T" + (time || "02:00") + ":00+09:00").toISOString();
}
function normalize(s) { return (s || "").replace(/\s/g, "").toLowerCase(); }
function giNumber(gi) {
  var m = String(gi || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}
function sortMembersForRotation(list) {
  return list.slice().sort(function(a, b) {
    var ga = giNumber(a.gi), gb = giNumber(b.gi);
    if (ga !== gb) return ga - gb;
    return String(a.name || "").localeCompare(String(b.name || ""), "ko");
  });
}
function schoolKey(school) { return promotionSchoolKey(school); }
function sortMembersByKoreanName(list) {
  return list.slice().sort(function(a, b) {
    var n = String(a.name || "").localeCompare(String(b.name || ""), "ko");
    if (n !== 0) return n;
    var g = giNumber(a.gi) - giNumber(b.gi);
    if (g !== 0) return g;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}
function daysBetweenKST(fromDate, toDate) {
  if (!fromDate || !toDate) return 9999;
  var from = new Date(fromDate + "T00:00:00+09:00");
  var to = new Date(toDate + "T00:00:00+09:00");
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}
function postTitleOf(mission) {
  if (!mission) return "";
  return mission.post_title || mission.title || "";
}
function postBodyOf(mission) {
  if (!mission) return "";
  return mission.post_body || mission.body || "";
}
async function fetchVisibleMemberMission(today) {
  var nowIso = new Date().toISOString();
  var open = await supabase
    .from("promotion_missions")
    .select("*")
    .eq("status", "active")
    .lte("mission_date", today)
    .gte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (open.data) return open;
  return await supabase.from("promotion_missions").select("*").eq("mission_date", today).maybeSingle();
}
function fitFontSize(text, normal, min, threshold, step) {
  var len = String(text || "").replace(/\s/g, "").length;
  if (len <= threshold) return normal;
  return Math.max(min, normal - Math.ceil((len - threshold) / (step || 5)));
}
function schoolMatch(input, dbSchool) {
  var a = normalize(input), b = normalize(dbSchool);
  return a === b || b.startsWith(a) || a.startsWith(b);
}
function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" }); }
  catch(e) { return iso; }
}
function fmtTime(iso) {
  if (!iso) return "";
  try {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  catch(e) { return ""; }
}
function inputDateFromIsoKST(iso) {
  if (!iso) return todayKST();
  try {
    var d = new Date(iso);
    var k = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    return k.getFullYear() + "-" + String(k.getMonth() + 1).padStart(2, "0") + "-" + String(k.getDate()).padStart(2, "0");
  } catch(e) { return todayKST(); }
}
function inputTimeFromIsoKST(iso) {
  if (!iso) return "02:00";
  try {
    var k = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    return String(k.getHours()).padStart(2, "0") + ":" + String(k.getMinutes()).padStart(2, "0");
  } catch(e) { return "02:00"; }
}
function fmtShortDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" }); }
  catch(e) { return iso; }
}
function useWindowWidth() {
  var _w = useState(typeof window !== "undefined" ? window.innerWidth : 1024);
  var winW = _w[0], setWinW = _w[1];
  useEffect(function() {
    function onResize() { setWinW(window.innerWidth); }
    window.addEventListener("resize", onResize);
    return function() { window.removeEventListener("resize", onResize); };
  }, []);
  return winW;
}
function useNowMs(intervalMs) {
  var _now = useState(function() { return Date.now(); });
  var now = _now[0], setNow = _now[1];
  useEffect(function() {
    var timer = setInterval(function() { setNow(Date.now()); }, intervalMs || 60000);
    return function() { clearInterval(timer); };
  }, [intervalMs]);
  return now;
}

var ST = { PENDING: "pending", SUBMITTED: "submitted", APPROVED: "approved", LATE: "late", MISSED: "missed", REJECTED: "rejected", EXEMPTED: "exempted" };
var STATUS_VALUES = [ST.PENDING, ST.SUBMITTED, ST.APPROVED, ST.LATE, ST.MISSED, ST.REJECTED, ST.EXEMPTED];
function promptRequiredReason(message, defaultReason) {
  var reason = window.prompt(message, defaultReason || "");
  if (!reason || !reason.trim()) {
    alert("상태 변경 사유를 입력해야 저장됩니다.");
    return null;
  }
  return reason.trim();
}
function promptStatusValue(currentStatus) {
  var status = window.prompt("변경할 상태를 입력해 주세요.\npending, submitted, approved, late, missed, rejected, exempted", currentStatus || ST.PENDING);
  if (!status) return null;
  status = status.trim().toLowerCase();
  if (STATUS_VALUES.indexOf(status) === -1) {
    alert("사용할 수 없는 상태입니다.");
    return null;
  }
  return status;
}
async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    var el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    var ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
// "반려"는 UI 라벨에서 사라지고 "미완료"로 통합. 부원 상세에서만 특이사항으로 표시.
var stLabel = function(s) {
  if (s === ST.APPROVED) return "인증 완료";
  if (s === ST.LATE) return "지각 완료";
  if (s === ST.SUBMITTED) return "제출됨";
  if (s === ST.PENDING) return "미제출";
  if (s === ST.EXEMPTED) return "면제";
  return "미완료";
};
var stColor = function(s) {
  if (s === ST.APPROVED) return "#10A26A";
  if (s === ST.LATE) return "#E05A00";
  if (s === ST.SUBMITTED) return "#3B72E8";
  if (s === ST.EXEMPTED) return "#6B7895";
  return "#E04848";
};
var stBg   = function(s) {
  if (s === ST.APPROVED) return "#E6F8EF";
  if (s === ST.LATE) return "#FFF4E5";
  if (s === ST.SUBMITTED) return "#E8F0FE";
  if (s === ST.EXEMPTED) return "#F1F4F9";
  return "#FDECEC";
};
var stNote = function(s) {
  if (s === ST.APPROVED) return "관리자 승인 완료";
  if (s === ST.LATE) return "마감 후 지각 인정";
  if (s === ST.SUBMITTED) return "제출 후 검토 대기";
  if (s === ST.EXEMPTED) return "달성률 계산 제외";
  if (s === ST.REJECTED) return "사진 반려됨 (재업로드 필요)";
  if (s === ST.MISSED) return "마감 후 미제출 확정";
  return "아직 제출 안 함";
};
function statusGroup(s) {
  if (s === ST.SUBMITTED) return "pending";
  if (s === ST.APPROVED || s === ST.LATE) return "done";
  return "incomplete";
}
function countsAsMissing(s) {
  return s === ST.PENDING || s === ST.MISSED || s === ST.REJECTED;
}
function statusSortRank(s) {
  var group = statusGroup(s);
  if (group === "pending") return 0;
  if (group === "incomplete") return 1;
  if (group === "done") return 2;
  return 3;
}

var BG = "linear-gradient(180deg, #F8FAFF 0%, #F4F7FF 55%, #FFFDF8 100%)";
var BLUE = "#3B72E8";
var INK = "#1A2340";
var SUB = "#6B7895";
var FONT = '-apple-system, "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

export default function App() {
  var _s = useState(function() {
    try { var v = localStorage.getItem("mast_eta_member_v4"); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  var session = _s[0], setSession = _s[1];

  function login(s) {
    if (s.role === "member") localStorage.setItem("mast_eta_member_v4", JSON.stringify(s));
    setSession(s);
  }
  function logout() {
    localStorage.removeItem("mast_eta_member_v4");
    setSession(null);
  }

  if (!session) return <LoginPage onLogin={login} />;
  if (session.role === "admin") return <AdminApp session={session} onLogout={logout} />;
  return <MemberApp session={session} onLogout={logout} />;
}

/* ════════════════════════════════════════════════
   LOGIN (레퍼런스 시안 그대로)
═══════════════════════════════════════════════════ */
function LoginPage(props) {
  var _n = useState(""), name = _n[0], setName = _n[1];
  var _g = useState(""), gi = _g[0], setGi = _g[1];
  var _sc = useState(""), school = _sc[0], setSchool = _sc[1];
  var _c = useState(""), code = _c[0], setCode = _c[1];
  var _sh = useState(false), showCode = _sh[0], setShowCode = _sh[1];
  var _e = useState(""), err = _e[0], setErr = _e[1];
  var _l = useState(false), loading = _l[0], setLoading = _l[1];

  // 화면 너비 감지 (반응형)
  var _w = useState(typeof window !== "undefined" ? window.innerWidth : 1024);
  var winW = _w[0], setWinW = _w[1];
  useEffect(function() {
    function onResize() { setWinW(window.innerWidth); }
    window.addEventListener("resize", onResize);
    return function() { window.removeEventListener("resize", onResize); };
  }, []);
  var isDesktop = winW >= 768;

  async function submit() {
    setErr("보안 로그인이 필요합니다. 회원 또는 관리자 로그인 화면으로 이동해 주세요.");
    window.location.assign(code.trim() ? "/admin-login" : "/login");
  }

  // 공통 콘텐츠 (카드 안/풀스크린 안에 똑같이 들어감)
  var content = (
    <>
      <img src={mastLogo} alt="MAST" style={{ height: 48, marginBottom: 10 }} />
      <div style={{ fontSize: 13, color: "#8093B8", marginBottom: 2, fontWeight: 500 }}>University Student</div>
      <div style={{ fontSize: 13, color: "#8093B8", marginBottom: 14, fontWeight: 500 }}>Academic Alliance</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: INK, marginBottom: 6, letterSpacing: -0.5 }}>홍보 활동 인증 시스템</div>

      <div style={{ marginTop: -85, marginBottom: -120, display: "flex", justifyContent: "center", position: "relative" }}>
        <img src={promotionHeroImg} alt="" style={{ width: "100%", maxWidth: isDesktop ? 380 : 340, height: "auto", filter: "drop-shadow(0 20px 28px rgba(60,100,200,0.22))", animation: "floaty 4s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: -4, left: "50%", transform: "translateX(-50%)", width: "50%", height: 14, background: "radial-gradient(ellipse, rgba(60,100,200,0.22) 0%, transparent 70%)", filter: "blur(5px)" }} />
      </div>
      <style>{"@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}"}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        <IconInput icon={<IconUser />} value={name} onChange={setName} placeholder="이름을 입력하세요" />
        <IconInput icon={<IconCap />} value={gi} onChange={setGi} placeholder="기수를 입력하세요 (예: 26기)" />
        <IconInput icon={<IconSchool />} value={school} onChange={setSchool} placeholder="학교를 입력하세요 (예: 홍익대학교)" />
        <IconInput
          icon={<IconLock />} value={code} onChange={setCode} type={showCode ? "text" : "password"}
          placeholder="관리자 코드를 입력하세요 (선택사항)"
          right={
            <button type="button" onClick={function() { setShowCode(function(v) { return !v; }); }}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: SUB, display: "flex", alignItems: "center" }}>
              {showCode ? <IconEyeOff /> : <IconEye />}
            </button>
          }
          onEnter={submit}
        />
      </div>

      {err && <div style={{ background: "#FDECEC", color: "#C0392B", fontSize: 13, fontWeight: 600, padding: "11px 14px", borderRadius: 12, marginBottom: 12 }}>{err}</div>}

      <button style={btnPrimary({ opacity: loading ? 0.7 : 1, borderRadius: 16, padding: "16px 0" })} disabled={loading} onClick={submit}>
        {loading ? "확인 중..." : "로그인"}
      </button>
      <div style={{ fontSize: 12, color: "#8A96AB", marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
        관리자 코드는 관리자에게 문의하세요. <IconHelp />
      </div>
      <div style={{ fontSize: 11, color: "#A8B2C5", marginTop: 8, lineHeight: 1.5 }}>
        ※ 세부 캠퍼스는 학교명만 입력해도 됩니다.
      </div>
    </>
  );

  // 데스크탑: 화면 중앙 카드 + 카드 밖에 큰 배경 구슬
  if (isDesktop) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #EEF4FC 0%, #DCE6F5 60%, #CDDCF2 100%)", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, position: "relative", overflow: "hidden" }}>
        {/* 카드 밖 큰 배경 구슬들 */}
        {/* 좌측 */}
        <Orb style={{ width: 220, height: 220, left: "6%", top: "8%" }} />
        <SaturnOrb style={{ width: 240, left: "3%", top: "38%" }} />
        <Orb style={{ width: 280, height: 280, left: "2%", bottom: "-4%" }} />
        <Orb style={{ width: 60, height: 60, left: "26%", top: "20%" }} />
        {/* 우측 */}
        <Orb style={{ width: 180, height: 180, right: "8%", top: "10%" }} />
        <Orb style={{ width: 80, height: 80, right: "20%", top: "42%" }} />
        <Orb style={{ width: 55, height: 55, right: "5%", top: "55%" }} />
        <YellowOrb style={{ width: 140, right: "8%", bottom: "8%" }} />
        <Orb style={{ width: 90, height: 90, right: "26%", bottom: "12%" }} />
        {/* 상단 작은 점 */}
        <Orb style={{ width: 40, height: 40, left: "50%", top: "8%" }} />

        {/* 중앙 카드 */}
        <div style={{ position: "relative", width: "100%", maxWidth: 460, background: "rgba(255,255,255,0.78)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: 32, boxShadow: "0 24px 70px rgba(60,100,200,0.18)", padding: "44px 52px", zIndex: 2, textAlign: "center", border: "1px solid rgba(255,255,255,0.6)" }}>
          {content}
        </div>
      </div>
    );
  }

  // 모바일: 풀스크린
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #EEF4FC 0%, #DCE6F5 60%, #CDDCF2 100%)", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px", position: "relative", overflow: "hidden" }}>
      {/* 모바일 배경 구슬 (시안 위치) */}
      <Orb style={{ width: 80, height: 80, right: 30, top: 90 }} />
      <Orb style={{ width: 25, height: 25, left: 50, top: 240 }} />
      <SaturnOrb style={{ width: 150, left: -50, top: 400 }} />
      <Orb style={{ width: 45, height: 45, right: 40, top: 460 }} />
      <Orb style={{ width: 20, height: 20, right: 90, top: 560 }} />
      <Orb style={{ width: 16, height: 16, right: 60, top: 690 }} />
      <Orb style={{ width: 65, height: 65, left: 15, bottom: 50 }} />
      <YellowOrb style={{ width: 80, right: 25, bottom: 25 }} />

      <div style={{ position: "relative", width: "100%", maxWidth: 360, textAlign: "center", paddingTop: 50, paddingBottom: 30, zIndex: 2 }}>
        {content}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════
   MEMBER APP
═══════════════════════════════════════════════════ */
function MemberApp(props) {
  var _tab = useState("home"), tab = _tab[0], setTab = _tab[1];
  var embedded = !!props.embedded;
  var tabs = [
    { key: "home", label: "홈", icon: <NavHome /> },
    { key: "cert", label: "인증", icon: <NavCheck /> },
    { key: "contest", label: "공모전", icon: <NavTrophy /> },
    { key: "record", label: "내 기록", icon: <NavList /> },
    { key: "profile", label: "내 정보", icon: <NavUser /> },
  ];
  function handleTabClick(key) {
    if (key === "home") {
      window.location.href = "/";
      return;
    }
    if (key === "contest") {
      window.location.href = "/contests";
      return;
    }
    setTab(key);
  }
  return (
    <div style={{ minHeight: embedded ? "auto" : "100vh", background: "transparent", fontFamily: FONT, paddingBottom: embedded ? 0 : 84 }}>
      <div style={{ maxWidth: 480, margin: "0 auto", position: "relative" }}>
        {tab === "home" && <MemberHome session={props.session} onTab={setTab} />}
        {tab === "cert" && <MemberCert session={props.session} onTab={setTab} />}
        {tab === "record" && <MemberRecord session={props.session} />}
        {tab === "profile" && <MemberProfile session={props.session} onLogout={props.onLogout} />}
      </div>
      {!embedded && <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 84, background: "#fff", borderTop: "1px solid #E5EAF2", display: "flex", zIndex: 30, maxWidth: 480, margin: "0 auto", boxShadow: "0 -8px 24px rgba(33,64,120,0.04)" }}>
        {tabs.map(function(t) {
          var active = tab === t.key;
          return (
            <button key={t.key} onClick={function() { handleTabClick(t.key); }}
              style={{ flex: 1, border: "none", background: "none", cursor: "pointer", fontFamily: FONT, padding: "14px 0 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, color: active ? "#0869F4" : "#8F99AA", position: "relative" }}>
              {t.icon}
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 500 }}>{t.label}</span>
              {active && <div style={{ position: "absolute", bottom: 8, width: 4, height: 4, borderRadius: "50%", background: BLUE }} />}
            </button>
          );
        })}
      </div>}
    </div>
  );
}

function MemberHome(props) {
  var session = props.session;
  var memberId = session.member.id;
  var today = todayKST();
  var _mission = useState(null), mission = _mission[0], setMission = _mission[1];
  var _myAssignment = useState(null), myAssignment = _myAssignment[0], setMyAssignment = _myAssignment[1];
  var _myProof = useState(null), myProof = _myProof[0], setMyProof = _myProof[1];
  var _assignees = useState([]), assignees = _assignees[0], setAssignees = _assignees[1];
  var _members = useState([]), members = _members[0], setMembers = _members[1];
  var _assignmentHistory = useState([]), assignmentHistory = _assignmentHistory[0], setAssignmentHistory = _assignmentHistory[1];
  var _records = useState([]), records = _records[0], setRecords = _records[1];
  var _loading = useState(true), loading = _loading[0], setLoading = _loading[1];
  var _showAllAssignees = useState(false), showAllAssignees = _showAllAssignees[0], setShowAllAssignees = _showAllAssignees[1];
  var _copyMsg = useState(""), copyMsg = _copyMsg[0], setCopyMsg = _copyMsg[1];
  var nowMs = useNowMs(60000);

  var load = useCallback(async function() {
    setLoading(true);
    var r1 = await fetchVisibleMemberMission(today);
    var missionRow = r1.data || null;
    setMission(missionRow);
    setMyAssignment(null); setMyProof(null); setAssignees([]);
    var rm = await supabase.from("members").select("id,name,gi,school,status");
    setMembers((rm.data || []).filter(function(m) { return (m.status || "active") === "active"; }));
    var rh = await supabase.from("promotion_assignment_status_view").select("member_id, member_name, gi, school, mission_date, status").lt("mission_date", today).order("mission_date", { ascending: false });
    setAssignmentHistory((rh.data || []).filter(isPromotionTarget));
    if (missionRow) {
      var r2 = await supabase.from("promotion_mission_assignments").select("*").eq("member_id", memberId).eq("mission_id", missionRow.id).maybeSingle();
      setMyAssignment(r2.data || null);
      if (r2.data) {
        var rp = await supabase.from("promotion_proofs").select("*").eq("assignment_id", r2.data.id).maybeSingle();
        setMyProof(rp.data || null);
      }
      var ra = await supabase.from("promotion_assignment_status_view").select("member_id, member_name, gi, school, status").eq("mission_id", missionRow.id);
      setAssignees((ra.data || []).filter(isPromotionTarget));
    }
    var r3 = await supabase.from("promotion_assignment_status_view").select("*").eq("member_id", memberId).order("mission_date", { ascending: false }).limit(5);
    setRecords(r3.data || []);
    setLoading(false);
  }, [memberId, today]);

  useEffect(function() { load(); }, [load]);

  var previewAssignee = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("previewAssignee") === "1";
  var isAssignee = previewAssignee || isPromotionTarget(myAssignment);
  var myStatus = myAssignment ? myAssignment.status : null;
  var submittedStatuses = [ST.SUBMITTED, ST.APPROVED, ST.LATE];
  var submittedCount = assignees.filter(function(a) { return submittedStatuses.indexOf(a.status) !== -1; }).length;
  var missingCount = Math.max(0, assignees.length - submittedCount);
  var dueLeftText = "마감까지 -";
  if (mission && mission.due_at) {
    var diff = new Date(mission.due_at).getTime() - nowMs;
    if (diff > 0) {
      var h = Math.floor(diff / 3600000);
      var mm = Math.floor((diff % 3600000) / 60000);
      dueLeftText = "마감까지 " + h + "시간 " + mm + "분 남음";
    } else {
      dueLeftText = "마감 시간이 지났어요";
    }
  }
  var assigneeMap = {};
  assignees.forEach(function(a) { assigneeMap[a.member_id] = a; });
  function rotationOrderedMembers(schoolMembers, todayPeople, historyRows) {
    var sorted = sortMembersByKoreanName(schoolMembers);
    if (!sorted.length) return [];
    var startId = todayPeople[0] ? todayPeople[0].member_id : "";
    if (!startId && historyRows[0]) {
      var lastIndex = sorted.findIndex(function(m) { return m.id === historyRows[0].member_id; });
      startId = sorted[(lastIndex + 1 + sorted.length) % sorted.length].id;
    }
    var startIndex = Math.max(0, sorted.findIndex(function(m) { return m.id === startId; }));
    return sorted.slice(startIndex).concat(sorted.slice(0, startIndex));
  }
  function daysUntilMemberTurn(schoolMembers, todayPeople, historyRows, targetId) {
    var sorted = sortMembersByKoreanName(schoolMembers);
    if (!sorted.length || !targetId) return null;
    if (todayPeople.some(function(a) { return a.member_id === targetId; })) return 0;
    var last = historyRows[0] || null;
    var ordered = rotationOrderedMembers(sorted, todayPeople, historyRows);
    var idx = ordered.findIndex(function(m) { return m.id === targetId; });
    if (idx < 0) return null;
    // 학교별 홍보 주기로 다음 순번까지 남은 일수를 계산합니다.
    var interval = promotionIntervalDays(sorted[0]?.school);
    var baseDelay = 0;
    if (!todayPeople.length && last) {
      // 오늘 배정자가 아직 없으면, 마지막 배정일 기준 다음 순번까지 남은 일수로 시작
      baseDelay = Math.max(0, interval - daysBetweenKST(last.mission_date, today));
    }
    return baseDelay + idx * interval;
  }
  function estimateMyTurnDays() {
    var mySchoolMembers = members.filter(function(m) { return schoolKey(m.school) === schoolKey(session.member.school); });
    if (!mySchoolMembers.length) return null;
    var todayPeople = assignees.filter(function(a) { return schoolKey(a.school) === schoolKey(session.member.school); });
    var historyRows = assignmentHistory.filter(function(a) { return schoolKey(a.school) === schoolKey(session.member.school); });
    return daysUntilMemberTurn(mySchoolMembers, todayPeople, historyRows, memberId);
  }
  var myTurnDays = estimateMyTurnDays();
  var myTurnText = myAssignment?.status === ST.EXEMPTED ? "이번 미션은 면제되었어요" : isAssignee ? "오늘 내 순번이에요" : (myTurnDays == null ? "내 순번 계산 중" : "내 순번까지 약 " + myTurnDays + "일");
  var schoolKeys = {};
  assignees.forEach(function(a) { schoolKeys[schoolKey(a.school)] = a.school; });
  if (session.member.school) schoolKeys[schoolKey(session.member.school)] = session.member.school;
  var schoolGroups = Object.keys(schoolKeys).map(function(key) {
    var schoolMembers = members.filter(function(m) { return schoolKey(m.school) === key; });
    var todayPeople = assignees.filter(function(a) { return schoolKey(a.school) === key; });
    var historyRows = assignmentHistory.filter(function(a) { return schoolKey(a.school) === key; });
    var orderedMembers = rotationOrderedMembers(schoolMembers, todayPeople, historyRows).map(function(m, idx) {
      var a = assigneeMap[m.id];
      return {
        member_id: m.id,
        member_name: m.name,
        gi: m.gi,
        school: m.school,
        status: a ? a.status : null,
        isTodayTarget: !!a,
        orderNo: idx + 1,
        daysUntilTurn: daysUntilMemberTurn(schoolMembers, todayPeople, historyRows, m.id)
      };
    });
    return { school: schoolKeys[key], people: orderedMembers, todayCount: todayPeople.length, isMySchool: key === schoolKey(session.member.school) };
  }).filter(function(g) { return g.people.length; });
  schoolGroups.sort(function(a, b) {
    if (a.isMySchool !== b.isMySchool) return a.isMySchool ? -1 : 1;
    return String(a.school || "").localeCompare(String(b.school || ""), "ko");
  });
  var visibleSchoolGroups = showAllAssignees ? schoolGroups : schoolGroups.slice(0, 3);
  var hasSubmittedMine = myProof || submittedStatuses.indexOf(myStatus) !== -1;

  async function copyHomePost(label, text) {
    var ok = await copyTextToClipboard(text);
    setCopyMsg(ok ? label + "을 복사했습니다." : "복사에 실패했습니다. 인증하기 화면에서 길게 눌러 복사해 주세요.");
  }

  return (
    <div style={{ padding: "14px 12px 18px", background: "transparent", minHeight: "calc(100vh - 84px)" }}>
      {loading ? (
        <div style={homeCard({ textAlign: "center", color: SUB })}>불러오는 중...</div>
      ) : !mission ? (
        <div style={homeHeroCard({ height: 258, overflow: "visible", background: "transparent" })}>
          <div style={{ position: "absolute", zIndex: 0, inset: "-80px -36px -58px -36px", background: "radial-gradient(circle at 72% 34%, rgba(190,225,255,.64), transparent 38%), radial-gradient(circle at 18% 24%, rgba(255,235,160,.24), transparent 34%)", pointerEvents: "none" }} />
          <img src={assets.hero.megaphone} alt="" style={{ position: "absolute", zIndex: 1, left: -18, bottom: -6, width: 188, height: "auto", objectFit: "contain", opacity: 0.8, pointerEvents: "none", filter: "drop-shadow(0 18px 30px rgba(58,105,220,0.14))" }} />
          <div style={{ position: "relative", zIndex: 3, paddingTop: 12, textAlign: "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", maxWidth: "calc(100vw - 42px)", minHeight: 30, padding: "0 12px", borderRadius: 16, background: "#F1FFF8", color: "#00A879", fontSize: 13, lineHeight: "20px", fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>오늘 홍보 미션 · {fmtShortDate(today)}</div>
            <div style={{ marginTop: 9, padding: "0 14px", fontSize: 18, lineHeight: "23px", color: "#071C59", fontWeight: 900, letterSpacing: "-0.03em", wordBreak: "keep-all" }}>오늘 등록된 미션이 없어요</div>
            <div style={{ marginTop: 8, fontSize: 18, lineHeight: "26px", fontWeight: 900, color: "#2F78F6", letterSpacing: "-0.04em", wordBreak: "keep-all" }}>새 홍보 미션이 올라오면 알려드릴게요</div>
          </div>
        </div>
      ) : (
        <div style={homeHeroCard({ height: 258, overflow: "visible", background: "transparent" })}>
          <div style={{ position: "absolute", zIndex: 0, inset: "-80px -36px -58px -36px", background: "radial-gradient(circle at 72% 34%, rgba(190,225,255,.64), transparent 38%), radial-gradient(circle at 18% 24%, rgba(255,235,160,.24), transparent 34%)", pointerEvents: "none" }} />
          <img src={assets.hero.megaphone} alt="" style={{ position: "absolute", zIndex: 1, left: -18, bottom: -6, width: 188, height: "auto", objectFit: "contain", opacity: 0.8, pointerEvents: "none", filter: "drop-shadow(0 18px 30px rgba(58,105,220,0.14))" }} />
          <div style={{ position: "relative", zIndex: 3, paddingTop: 12, textAlign: "center" }}>
            {/* 날짜: 10% 크게 + 위로 10 이동, 전체 가운데 */}
            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", maxWidth: "calc(100vw - 42px)", minHeight: 30, padding: "0 12px", borderRadius: 16, background: "#F1FFF8", color: "#00A879", fontSize: fitFontSize("오늘 홍보 미션 · " + fmtShortDate(today), 14, 11, 13, 4), lineHeight: "20px", fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>오늘 홍보 미션 · {fmtShortDate(today)}</div>
            {/* 미션 이름: 날짜 아래, 전체 가운데 */}
            <div style={{ marginTop: 9, padding: "0 14px", fontSize: fitFontSize(mission.title, 18, 13, 18, 6), lineHeight: "23px", color: "#071C59", fontWeight: 900, letterSpacing: "-0.03em", wordBreak: "keep-all", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{mission.title}</div>
            {/* 멘트: 미션 이름 아래로 */}
            <div style={{ marginTop: 8, fontSize: 22, lineHeight: "28px", fontWeight: 900, color: "#2F78F6", letterSpacing: "-0.04em", wordBreak: "keep-all" }}>{isAssignee ? "오늘 대상자입니다" : "오늘 대상자가 아니에요"}</div>
            <button onClick={function() { props.onTab(isAssignee ? "cert" : "record"); }} style={{ marginTop: 13, width: "100%", maxWidth: 140, height: 44, border: "none", borderRadius: 15, background: "linear-gradient(135deg,#4AA3FF,#0860EC)", color: "#fff", fontSize: 15, fontWeight: 900, fontFamily: FONT, boxShadow: "0 12px 24px rgba(8,105,244,0.24)", cursor: "pointer", transform: "translate(57px, 10px)" }}>
              {isAssignee ? "인증하기" : "내 기록"} <span style={{ marginLeft: 6, fontSize: 22, lineHeight: 0 }}>›</span>
            </button>
          </div>
        </div>
      )}

      {mission && isAssignee && (
        <>
          <div style={homeCard({ padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, border: "1px solid #FFE2B8", background: "linear-gradient(135deg, #FFF8EC 0%, #FFF3F2 100%)", boxShadow: "0 10px 24px rgba(224,90,0,0.08)" })}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#FFE2B8", color: "#E05A00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 900, flexShrink: 0 }}>!</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, lineHeight: "17px", fontWeight: 900, color: "#C45100" }}>게시판 선택 주의</div>
              <div style={{ fontSize: 12, lineHeight: "17px", fontWeight: 800, color: "#4A5568", wordBreak: "keep-all" }}>홍보글은 반드시 동아리/학회 게시판에만 올려주세요. 다른 게시판 업로드는 신고 대상이 될 수 있습니다.</div>
            </div>
          </div>

          <div style={homeCard({ padding: 14 })}>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#08235E", marginBottom: 9 }}>게시물 내용</div>
            <div style={{ fontSize: fitFontSize(postTitleOf(mission), 12, 10, 18, 7), lineHeight: "18px", color: SUB, fontWeight: 800, marginBottom: 10, whiteSpace: "normal", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "keep-all" }}>{postTitleOf(mission) || "게시물 제목 없음"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={function() { copyHomePost("게시글 제목", postTitleOf(mission)); }} style={btnSmall({ background: "#EEF5FF", color: BLUE, borderRadius: 12, padding: "11px 8px", fontSize: 12 })}>게시글 제목 복사</button>
              <button onClick={function() { copyHomePost("게시글 내용", promotionCopyForSchool(postBodyOf(mission), session.member.school)); }} style={btnSmall({ background: "#EEF5FF", color: BLUE, borderRadius: 12, padding: "11px 8px", fontSize: 12 })}>게시글 내용 복사</button>
            </div>
            <button onClick={function() { copyHomePost("게시글 제목+내용", [postTitleOf(mission), promotionCopyForSchool(postBodyOf(mission), session.member.school)].filter(Boolean).join("\n\n")); }} style={btnPrimary({ marginTop: 8, borderRadius: 14, padding: "12px 0", fontSize: 14 })}>게시글 제목+내용 복사</button>
            {copyMsg && <div style={{ marginTop: 9, fontSize: 12, color: copyMsg.indexOf("실패") !== -1 ? "#E04848" : "#10A26A", fontWeight: 900 }}>{copyMsg}</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            <div style={homeCard({ minHeight: 96, padding: 12, display: "flex", flexDirection: "column", justifyContent: "space-between" })}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: submittedStatuses.indexOf(myStatus) !== -1 ? "#10B888" : "#A9B2C4", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <IconCheck color="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: 16, lineHeight: "22px", fontWeight: 900, color: "#08235E" }}>{submittedStatuses.indexOf(myStatus) !== -1 ? "제출 완료" : "미제출"}</div>
                  {myAssignment && myAssignment.submitted_at && <div style={{ fontSize: 12, lineHeight: "18px", color: "#08235E", marginTop: 2, fontWeight: 700 }}>오늘 {fmtTime(myAssignment.submitted_at)}에 제출했어요</div>}
                </div>
              </div>
              <div style={{ height: 32, borderRadius: 12, background: "#EEF8F4", color: "#00A879", fontSize: 13, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{dueLeftText}</div>
            </div>
            <button onClick={function() { props.onTab("cert"); }} style={homeCard({ minHeight: 96, padding: 16, border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT, position: "relative" })}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#EFF5FF", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8, overflow: "hidden" }}>
                <img src={assets.icon.camera} alt="" style={{ width: 50, height: 50, objectFit: "contain", transform: "translateY(2px)" }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#0869F4", marginBottom: 4 }}>{hasSubmittedMine ? "사진 수정" : "인증하기"}</div>
              <div style={{ fontSize: 12, lineHeight: "18px", color: "#08235E", fontWeight: 700 }}>{hasSubmittedMine ? "제출한 사진을 변경할 수 있어요" : "게시글 캡처를 제출해 주세요"}</div>
              <div style={{ position: "absolute", right: 16, top: 42, fontSize: 34, color: "#0869F4", lineHeight: 1 }}>›</div>
            </button>
          </div>
        </>
      )}

      {mission && !isAssignee && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <button onClick={function() { props.onTab("record"); }} style={homeCard({ minHeight: 96, padding: 16, border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT, position: "relative" })}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#EEF5FF", color: "#0869F4", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}><NavList /></div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#08235E", marginBottom: 4 }}>내 기록</div>
            <div style={{ fontSize: 12, lineHeight: "18px", color: "#66728A", fontWeight: 700 }}>이전 미션 상태를 확인해요</div>
          </button>
          <button onClick={function() { setShowAllAssignees(true); }} style={homeCard({ minHeight: 96, padding: 16, border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT, position: "relative" })}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F1FFF8", color: "#00A879", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}><NavUser /></div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#08235E", marginBottom: 4 }}>대상자 보기</div>
            <div style={{ fontSize: 12, lineHeight: "18px", color: "#66728A", fontWeight: 700 }}>오늘 담당 명단을 확인해요</div>
          </button>
        </div>
      )}

      {mission && (
        <div style={homeCard({ padding: "16px 12px 12px" })}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingBottom: 10, borderBottom: "1px solid #E9EEF7" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#08235E" }}>오늘 대상자 명단 <span style={{ color: "#7C88A0" }}>({assignees.length}명)</span></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 800, color: "#66728A", whiteSpace: "nowrap" }}>
              <span><IconDot color="#10B888" size={8} /> 제출 {submittedCount}명</span>
              <span><IconDot color="#A9B2C4" size={8} /> 미제출 {missingCount}명</span>
            </div>
          </div>
          {visibleSchoolGroups.map(function(group, idx) {
            return (
              <div key={group.school} style={{ padding: "10px 0", borderBottom: idx === Math.min(visibleSchoolGroups.length - 1, visibleSchoolGroups.length - 1) ? "none" : "1px solid #EEF2F8" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                  <IconSchoolSolid type="school" />
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#08235E", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.school}</div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: group.isMySchool ? "#0869F4" : "#7C88A0" }}>{group.isMySchool ? "내 학교 · " : ""}{group.people.length}명</div>
                </div>
                <div style={{ display: "flex", gap: 5, overflowX: "auto", padding: "1px 2px 5px", scrollSnapType: "x proximity", WebkitOverflowScrolling: "touch" }}>
                  {group.people.map(function(p) {
                    var mine = p.member_id === memberId;
                    var isTodayTarget = !!p.isTodayTarget;
                    var submitted = submittedStatuses.indexOf(p.status) !== -1;
                    return (
                      <div key={p.member_id} style={{ width: 72, minWidth: 72, minHeight: 42, borderRadius: 11, background: isTodayTarget ? (mine ? "#E8F8F2" : "#EEF5FF") : "#F8FAFF", border: isTodayTarget ? (mine ? "1px solid #BDEDDC" : "1px solid #CFE0FF") : "1px solid #EEF2F8", padding: "5px 6px", display: "grid", gridTemplateRows: "auto auto", gap: 2, scrollSnapAlign: "start" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                          <span style={{ width: 16, height: 16, borderRadius: "50%", background: isTodayTarget ? (mine ? "#00A879" : "#0869F4") : "#E8EEF8", color: isTodayTarget ? "#fff" : "#66728A", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 900, flexShrink: 0 }}>{p.orderNo}</span>
                          <span style={{ minWidth: 0, fontSize: 12, lineHeight: "15px", fontWeight: 900, color: mine ? "#00A879" : (isTodayTarget ? "#0869F4" : "#08235E"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.member_name}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3 }}>
                          {mine ? <span style={{ borderRadius: 999, background: "#DDF7EE", color: "#00A879", padding: "1px 4px", fontSize: 8, fontWeight: 900 }}>나</span> : <span />}
                          <span style={{ borderRadius: 999, background: isTodayTarget ? (submitted ? "#E8F8F2" : "#EAF2FF") : "#EEF2F8", color: isTodayTarget ? (submitted ? "#00A879" : "#0869F4") : "#7C88A0", padding: "1px 5px", fontSize: 9, fontWeight: 900 }}>{isTodayTarget ? (submitted ? "제출" : "오늘") : ("다음 " + p.daysUntilTurn + "일")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <button onClick={function() { setShowAllAssignees(!showAllAssignees); }} style={{ marginTop: 8, width: "100%", height: 40, border: "none", borderRadius: 14, background: "#F0F5FF", color: "#0869F4", fontSize: 15, fontWeight: 900, fontFamily: FONT, cursor: "pointer" }}>{showAllAssignees ? "접기" : "전체 명단 보기"} <span style={{ fontSize: 20, marginLeft: 6 }}>{showAllAssignees ? "⌃" : "⌄"}</span></button>
        </div>
      )}
      {!mission && records.length > 0 && (
        <div style={homeCard({ padding: 0, overflow: "hidden" })}>
          {records.map(function(r, i) {
            return (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 18px", borderTop: i ? "1px solid #F1F4F9" : "none" }}>
                <div style={{ fontSize: 13, color: "#4A5568", fontWeight: 600 }}>{fmtDate(r.mission_date)}</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: stColor(r.status), background: stBg(r.status), padding: "4px 12px", borderRadius: 999 }}>{stLabel(r.status)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MemberCert(props) {
  var session = props.session;
  var memberId = session.member.id;
  var today = todayKST();
  var _mission = useState(null), mission = _mission[0], setMission = _mission[1];
  var _myAssignment = useState(null), myAssignment = _myAssignment[0], setMyAssignment = _myAssignment[1];
  var _myProof = useState(null), myProof = _myProof[0], setMyProof = _myProof[1];
  var _loading = useState(true), loading = _loading[0], setLoading = _loading[1];
  var _done = useState(false), done = _done[0], setDone = _done[1];
  var _copyMsg = useState(""), copyMsg = _copyMsg[0], setCopyMsg = _copyMsg[1];
  var _expand = useState(false), expand = _expand[0], setExpand = _expand[1];

  var load = useCallback(async function() {
    setLoading(true);
    var r1 = await fetchVisibleMemberMission(today);
    var missionRow = r1.data || null;
    setMission(missionRow);
    setMyAssignment(null); setMyProof(null);
    if (missionRow) {
      var r2 = await supabase.from("promotion_mission_assignments").select("*").eq("member_id", memberId).eq("mission_id", missionRow.id).maybeSingle();
      setMyAssignment(r2.data || null);
      if (r2.data) {
        var rp = await supabase.from("promotion_proofs").select("*").eq("assignment_id", r2.data.id).maybeSingle();
        setMyProof(rp.data || null);
      }
    }
    setLoading(false);
  }, [memberId, today]);

  useEffect(function() { load(); }, [load]);

  var isAssignee = isPromotionTarget(myAssignment);

  async function copyPostText(label, text) {
    var ok = await copyTextToClipboard(text);
    setCopyMsg(ok ? label + "을 복사했습니다." : "복사에 실패했습니다. 길게 눌러 직접 복사해 주세요.");
  }

  function fullPostText() {
    return [postTitleOf(mission), promotionCopyForSchool(postBodyOf(mission), session.member.school)].filter(Boolean).join("\n\n");
  }

  if (loading) return <CenteredMsg msg="불러오는 중..." />;

  if (done) return (
    <div style={{ padding: "0 16px" }}>
      <PageHeader title="인증 완료" />
      <div style={{ padding: "20px 0", textAlign: "center", position: "relative" }}>
        {/* 장식 파티클 */}
        <div style={{ position: "absolute", left: "15%", top: 40, width: 8, height: 8, background: "#FBBF24", borderRadius: 2, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", right: "20%", top: 20, width: 7, height: 7, background: "#3B72E8", borderRadius: 2, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", left: "10%", top: 180, width: 6, height: 6, background: "#E04848", borderRadius: 2, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", right: "12%", top: 160, width: 8, height: 8, background: "#10A26A", borderRadius: 2, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", right: "30%", top: 220, width: 5, height: 5, background: "#FBBF24", borderRadius: 2, transform: "rotate(45deg)" }} />

        <div style={{ marginBottom: 28, display: "flex", justifyContent: "center" }}>
          <svg width="200" height="200" viewBox="0 0 48 48" role="img" aria-label="인증 완료" style={{ filter: "drop-shadow(0 16px 28px rgba(16,162,106,0.25))" }}>
            <circle cx="24" cy="24" r="20" fill="#22C55E" />
            <path d="M15 24.5 L21 30.5 L34 17" fill="none" stroke="#fff" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color: INK, marginBottom: 6 }}>인증이 제출되었습니다!</div>
        <div style={{ fontSize: 14, color: SUB, marginBottom: 28 }}>관리자 승인 후 인증 완료로 표시됩니다.</div>
        <button style={btnPrimary()} onClick={function() { setDone(false); props.onTab("home"); }}>홈으로 돌아가기</button>
      </div>
    </div>
  );

  if (!mission) return (
    <div style={{ padding: "0 16px" }}>
      <PageHeader title="인증하기" />
      <CenteredMsg msg="오늘 등록된 홍보 미션이 없습니다." />
    </div>
  );

  if (myAssignment?.status === ST.EXEMPTED) return (
    <div style={{ padding: "0 16px" }}>
      <PageHeader title="홍보 미션 면제" />
      <div style={card()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>이번 미션은 면제되었습니다</div>
        <p style={{ color: SUB }}>홍보 대상에서 제외되어 사진을 제출하지 않아도 됩니다. 미제출로 집계되거나 감점되지 않습니다.</p>
        <button style={btnPrimary()} onClick={function() { props.onTab("home"); }}>홈으로 돌아가기</button>
      </div>
    </div>
  );

  if (!isAssignee) return (
    <div style={{ padding: "0 16px" }}>
      <PageHeader title="인증하기" />
      <div style={{ padding: "60px 24px", textAlign: "center" }}>
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}><IconLockBig /></div>
        <div style={{ fontSize: 18, fontWeight: 800, color: INK, marginBottom: 8 }}>오늘 담당자가 아닙니다</div>
        <div style={{ fontSize: 14, color: SUB }}>인증은 오늘 지정된 담당자만 가능합니다.</div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "0 16px" }}>
      <PageHeader title="인증하기" />

      <div style={card({ marginBottom: 16, border: "1px solid #BBD6FF", background: "linear-gradient(135deg,#EFF5FF,#F3F8FF)" })}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: "#0860EC", marginBottom: 7 }}>📢 에브리타임 홍보 관련 안내</div>
        <div style={{ fontSize: 12.5, lineHeight: "19px", color: "#42506A", fontWeight: 700, wordBreak: "keep-all" }}>
          각 학교 에브리타임 게시판 기준으로, 우리 동아리 게시글이 <b style={{ color: "#0860EC" }}>최신 상단 5개 안</b>에 포함되어 있으면 추가 업로드를 하지 않으셔도 됩니다.<br />
          캡처본 업로드 시 <b style={{ color: "#0860EC" }}>해당 게시판의 최신 글 목록이 보이도록</b> 캡처해 보내주시면 홍보를 진행한 것으로 인정하여 카운팅합니다. 감사합니다!
        </div>
      </div>

      <div style={card({ marginBottom: 16, border: "1px solid #E5EAF2", background: "#fff" })}>
        <div style={{ fontSize: 11, fontWeight: 900, color: "#66728A", marginBottom: 6 }}>오늘 미션</div>
        <div style={{ fontSize: fitFontSize(mission.title, 17, 13, 18, 7), lineHeight: "24px", fontWeight: 900, color: INK, marginBottom: mission.body ? 8 : 0, wordBreak: "keep-all" }}>{mission.title}</div>
        {mission.body && (
          <div>
            <div style={Object.assign({ fontSize: 13, lineHeight: 1.65, color: "#42506A", fontWeight: 700, whiteSpace: "pre-wrap", wordBreak: "break-word" }, expand ? {} : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" })}>{mission.body}</div>
            <button onClick={function() { setExpand(!expand); }} style={{ marginTop: 6, border: "none", background: "none", color: BLUE, fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: FONT, padding: 0 }}>{expand ? "접기 ▲" : "자세히보기 ▼"}</button>
          </div>
        )}
      </div>

      <div style={card({ marginBottom: 16 })}>
        <div style={{ fontSize: 11, fontWeight: 900, color: BLUE, marginBottom: 6 }}>게시글 올리기 도우미</div>
        <div style={{ fontSize: fitFontSize(postTitleOf(mission), 18, 13, 18, 7), lineHeight: "25px", fontWeight: 900, color: INK, marginBottom: 8, wordBreak: "keep-all" }}>{postTitleOf(mission)}</div>
        <div style={{ fontSize: fitFontSize(mission.title, 12, 10, 22, 8), color: SUB, fontWeight: 800, marginBottom: 8, wordBreak: "keep-all" }}>미션: {mission.title}</div>
        <div style={{ fontSize: 12, color: "#E05A00", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
          <IconClock color="#E05A00" />마감 {fmtTime(mission.due_at)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
          <button onClick={function() { copyPostText("게시글 제목", postTitleOf(mission)); }} style={btnSmall({ background: "#EEF5FF", color: BLUE, borderRadius: 12, padding: "11px 8px", fontSize: 12 })}>게시글 제목 복사</button>
          <button onClick={function() { copyPostText("게시글 내용", promotionCopyForSchool(postBodyOf(mission), session.member.school)); }} style={btnSmall({ background: "#EEF5FF", color: BLUE, borderRadius: 12, padding: "11px 8px", fontSize: 12 })}>게시글 내용 복사</button>
        </div>
        <button onClick={function() { copyPostText("게시글 제목+내용", fullPostText()); }} style={btnPrimary({ marginTop: 8, borderRadius: 14, padding: "13px 0", fontSize: 14 })}>게시글 제목+내용 복사</button>
        {copyMsg && <div style={{ marginTop: 10, fontSize: 12, color: copyMsg.indexOf("실패") !== -1 ? "#E04848" : "#10A26A", fontWeight: 900 }}>{copyMsg}</div>}

        <div style={{ marginTop: 14, border: "1px solid #E5EAF2", borderRadius: 16, overflow: "hidden", background: "#F8FAFF" }}>
          <div style={{ padding: "11px 12px", borderBottom: "1px solid #E5EAF2" }}>
            <div style={{ fontSize: 11, color: SUB, fontWeight: 900, marginBottom: 4 }}>게시글 제목</div>
            <div style={{ fontSize: fitFontSize(postTitleOf(mission), 13, 10, 18, 7), color: INK, fontWeight: 800, wordBreak: "break-word" }}>{postTitleOf(mission) || "입력된 제목이 없습니다."}</div>
          </div>
          <div style={{ padding: "11px 12px" }}>
            <div style={{ fontSize: 11, color: SUB, fontWeight: 900, marginBottom: 4 }}>게시글 내용</div>
            <div style={{ fontSize: 13, lineHeight: 1.65, color: INK, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{promotionCopyForSchool(postBodyOf(mission), session.member.school) || "입력된 내용이 없습니다."}</div>
          </div>
        </div>

        {mission.mission_image_url && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #F1F4F9" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
              <IconAttach color={SUB} />첨부 이미지 (다운로드해서 에타에 업로드)
            </div>
            <img src={mission.mission_image_url} alt="미션 첨부" style={{ width: "100%", borderRadius: 12, border: "1px solid #E5EAF2" }} />
            <a href={mission.mission_image_url} download target="_blank" rel="noreferrer"
               style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, padding: "10px 0", background: "#F0F4FB", color: BLUE, fontWeight: 700, fontSize: 13, borderRadius: 10, textDecoration: "none" }}>
              <IconDownload />이미지 다운로드
            </a>
          </div>
        )}
      </div>

      {myAssignment && (myAssignment.status === ST.APPROVED || myAssignment.status === ST.LATE) ? (
        <div style={card({ background: "#E6F8EF", border: "1px solid #B8E6CD" })}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <IconCheck color="#10A26A" />
            <span style={{ fontSize: 15, fontWeight: 800, color: "#10A26A" }}>{stLabel(myAssignment.status)}</span>
            <span style={{ fontSize: 12, color: SUB, marginLeft: "auto" }}>{fmtTime(myAssignment.submitted_at)}</span>
          </div>
          <div style={{ fontSize: 13, color: "#4A5568" }}>승인되었습니다. 수고하셨습니다.</div>
        </div>
      ) : (
        <UploadForm member={session.member} assignment={myAssignment} mission={mission}
          existingProof={myProof} onAssignmentChanged={function(next) { setMyAssignment(Object.assign({}, myAssignment, next)); }} onDone={function() { setDone(true); }} />
      )}

      <div style={card({ marginTop: 16, background: "rgba(255,255,255,0.7)" })}>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 8 }}>인증 시 유의사항</div>
        <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7 }}>
          • 에브리타임 게시글이 보이도록 캡처해주세요.<br />
          • 조작된 이미지가 확인될 경우 인정되지 않습니다.
        </div>
      </div>

    </div>
  );
}

function UploadForm(props) {
  var member = props.member, assignment = props.assignment, mission = props.mission, existingProof = props.existingProof;
  var _file = useState(null), file = _file[0], setFile = _file[1];
  var _preview = useState(null), preview = _preview[0], setPreview = _preview[1];
  var _busy = useState(false), busy = _busy[0], setBusy = _busy[1];
  var _err = useState(""), err = _err[0], setErr = _err[1];
  var _skip = useState(false), skipped = _skip[0], setSkipped = _skip[1];
  var fileRef = useRef(null);

  function pick(e) {
    var f = e.target.files ? e.target.files[0] : null;
    if (!f) return;
    if (!/^image\//.test(f.type)) { setErr("이미지 파일만 업로드 가능합니다."); return; }
    setErr(""); setFile(f);
    var reader = new FileReader();
    reader.onload = function() { setPreview(reader.result); };
    reader.readAsDataURL(f);
  }

  async function submit() {
    if (busy) return;
    if (!file && !existingProof) { setErr("사진을 선택해 주세요."); return; }
    if (file && file.size > 10 * 1024 * 1024) { setErr("사진은 10MB 이하로 선택해 주세요."); return; }
    setBusy(true); setErr("");
    try {
      var latest = await supabase.from("promotion_mission_assignments").select("status,late_until_at").eq("id", assignment.id).maybeSingle();
      if (latest.error) throw latest.error;
      if (!latest.data) throw new Error("배정 정보를 찾지 못했습니다.");
      if (latest.data.status === ST.EXEMPTED) {
        props.onAssignmentChanged(latest.data);
        return;
      }
      if ([ST.APPROVED, ST.LATE, ST.MISSED].includes(latest.data.status)) throw new Error("본인 인증 제출 상태가 변경되었습니다.");
      var nowIso = new Date().toISOString();
      if (latest.data.late_until_at && new Date(nowIso) > new Date(latest.data.late_until_at)) {
        setErr("지각 제출 가능 시간이 지났습니다. 관리자에게 문의해 주세요.");
        setBusy(false);
        return;
      }
      var row = { assignment_id: assignment.id, mission_id: mission.id, member_id: member.id, submitted_at: nowIso };

      if (file) {
        var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!ext) ext = "jpg";
        var safeKey = encodeURIComponent(keyOf(member)).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20);
        var path = member.id + "/" + mission.mission_date + "/" + safeKey + "_" + Date.now() + "." + ext;
        var upRes = await supabase.storage.from(PROOF_BUCKET).upload(path, file, { upsert: true });
        if (upRes.error) throw upRes.error;
        row.proof_image_url = supabase.storage.from(PROOF_BUCKET).getPublicUrl(path).data.publicUrl;
        row.proof_file_path = path;
      }

      var saved = await supabase.rpc("mast_submit_promotion_proof", {
        p_assignment_id: assignment.id,
        p_file_path: row.proof_file_path || existingProof?.proof_file_path,
        p_skipped: skipped,
      });
      if (saved.error) throw saved.error;
      if (!saved.data?.ok) throw new Error("인증 저장을 확인하지 못했습니다.");
      if (file && existingProof?.proof_file_path) {
        await supabase.storage.from(PROOF_BUCKET).remove([existingProof.proof_file_path]);
      }
      props.onDone();
    } catch(e) {
      setErr(promotionSubmissionError(e));
      console.error("promotion proof submission failed", e);
    }
    finally { setBusy(false); }
  }

  var existingImg = existingProof && existingProof.proof_image_url;

  return (
    <div style={card()}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#4A5568", marginBottom: 10 }}>에타 게시글 캡처 이미지를 업로드해주세요</div>
      {existingProof && (
        <div style={{ fontSize: 12, color: assignment.status === ST.REJECTED ? "#E04848" : "#3B72E8", marginBottom: 10, fontWeight: 600 }}>
          {assignment.status === ST.REJECTED ? "사진 반려됨. 다시 올려주세요." : "이미 제출되었습니다. 사진을 변경할 수 있습니다."}
        </div>
      )}

      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0860EC", background: "#EAF2FF", borderRadius: 12, padding: "10px 12px", marginBottom: 12, lineHeight: "18px", wordBreak: "keep-all", textAlign: "center" }}>우리 동아리 게시글이 게시판 최신 상단 5개 안에 있으면 도배 방지를 위해 추가 업로드 없이 건너뛰기 해주세요. 캡처는 최신 글 목록이 보이도록 올려주세요.</div>
      {(preview || existingImg) ? (
        <div style={{ position: "relative", marginBottom: 12 }}>
          <SecureProofImage src={preview || existingImg} path={preview ? null : existingProof?.proof_file_path} alt="미리보기" style={{ width: "100%", maxHeight: 300, objectFit: "contain", borderRadius: 14, border: "1px solid #E5EAF2" }} />
          <button onClick={function() { fileRef.current && fileRef.current.click(); }}
            style={{ position: "absolute", top: 8, right: 8, border: "none", borderRadius: 8, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, padding: "5px 12px", cursor: "pointer", fontFamily: FONT, fontWeight: 600 }}>변경</button>
        </div>
      ) : (
        <div onClick={function() { fileRef.current && fileRef.current.click(); }}
          style={{ border: "2px dashed #BCD0F0", borderRadius: 16, padding: "28px 16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "rgba(248,250,255,0.6)", marginBottom: 12 }}>
          <img src={cameraImg} alt="" style={{ width: 200, height: "auto", filter: "drop-shadow(0 10px 20px rgba(60,100,200,0.15))" }} />
          <div style={{ fontSize: 14, color: SUB, marginTop: 12, fontWeight: 600 }}>에타 게시글 캡처 이미지를</div>
          <div style={{ fontSize: 14, color: SUB, fontWeight: 600 }}>업로드해주세요</div>
          <div style={{ fontSize: 11, color: "#A8B2C5", marginTop: 6 }}>JPG, PNG (최대 10MB)</div>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
      {err && <div style={{ fontSize: 13, color: "#C0392B", marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button
        onClick={function() { setSkipped(!skipped); }}
        style={{ width: "100%", marginBottom: 10, border: skipped ? "1px solid #0869F4" : "1px solid #D5DEEC", background: skipped ? "#EAF2FF" : "#fff", color: skipped ? "#0869F4" : "#5A6478", borderRadius: 14, padding: "12px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <span style={{ width: 18, height: 18, borderRadius: 5, border: skipped ? "none" : "1.5px solid #C2CCDC", background: skipped ? "#0869F4" : "#fff", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, lineHeight: 0 }}>{skipped ? "✓" : ""}</span>
        건너뛰기 (이미 관련 게시물이 있어요)
      </button>
      <button style={btnPrimary({ opacity: busy ? 0.7 : 1 })} disabled={busy} onClick={submit}>
        {busy ? "업로드 중..." : existingProof ? "사진 수정 완료" : "인증 제출"}
      </button>
    </div>
  );
}

function MemberRecord(props) {
  var memberId = props.session.member.id;
  var _records = useState([]), records = _records[0], setRecords = _records[1];
  var _loading = useState(true), loading = _loading[0], setLoading = _loading[1];

  useEffect(function() {
    (async function() {
      var r = await supabase.from("promotion_assignment_status_view").select("*").eq("member_id", memberId).order("mission_date", { ascending: false });
      setRecords(r.data || []);
      setLoading(false);
    })();
  }, [memberId]);

  var approved = records.filter(function(r) { return r.status === ST.APPROVED || r.status === ST.LATE; }).length;
  var rated = records.filter(function(r) { return r.counts_in_rate; }).length;
  var earned = records.reduce(function(sum, r) { return sum + (r.completion_score || 0); }, 0);

  return (
    <div style={{ padding: "0 16px" }}>
      <PageHeader title="내 기록" />
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <StatBox label="인증완료" value={approved} color={BLUE} />
        <StatBox label="평가 미션" value={rated} color={INK} />
        <StatBox label="인증률" value={(rated ? Math.round(earned / rated * 100) : 0) + "%"} color="#10A26A" />
      </div>
      {loading ? <CenteredMsg msg="불러오는 중..." /> : (
        <div style={card({ padding: 0, overflow: "hidden" })}>
          {records.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 14, color: SUB }}>기록이 없습니다.</div>
          ) : records.map(function(r, i) {
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderTop: i ? "1px solid #F1F4F9" : "none" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>{fmtDate(r.mission_date)}</div>
                  <div style={{ fontSize: 12, color: SUB, marginTop: 3 }}>제출 {fmtTime(r.submitted_at)}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: stColor(r.status), background: stBg(r.status), padding: "4px 12px", borderRadius: 999 }}>{stLabel(r.status)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatBox(props) {
  return (
    <div style={card({ flex: 1, textAlign: "center", padding: 14 })}>
      <div style={{ fontSize: 11, color: SUB, fontWeight: 600 }}>{props.label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: props.color, marginTop: 4 }}>{props.value}</div>
    </div>
  );
}

function MemberProfile(props) {
  var m = props.session.member;
  return (
    <div style={{ padding: "0 16px" }}>
      <PageHeader title="내 정보" />
      <div style={card({ marginBottom: 16 })}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#3B72E8,#5A8EF5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 20, fontWeight: 800 }}>
            {m.name.slice(0, 1)}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>{m.name}</div>
            <div style={{ fontSize: 13, color: SUB }}>{m.gi}</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderTop: "1px solid #F1F4F9" }}>
          <span style={{ fontSize: 13, color: SUB }}>학교</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{m.school}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderTop: "1px solid #F1F4F9" }}>
          <span style={{ fontSize: 13, color: SUB }}>기수</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{m.gi}</span>
        </div>
      </div>
      <button style={btnGhost({ color: "#E04848" })} onClick={props.onLogout}>로그아웃</button>
    </div>
  );
}

/* ════════════════════════════════════════════════
   ADMIN APP
═══════════════════════════════════════════════════ */
function AdminApp(props) {
  var embedded = !!props.embedded;
  var _tab = useState(props.initialTab || "dashboard"), tab = _tab[0], setTab = _tab[1];
  var _moreOpen = useState(false), moreOpen = _moreOpen[0], setMoreOpen = _moreOpen[1];
  var _sidebarCollapsed = useState(false), sidebarCollapsed = _sidebarCollapsed[0], setSidebarCollapsed = _sidebarCollapsed[1];
  var winW = useWindowWidth();
  var isMobile = winW < 768;
  var compactNav = isMobile || embedded;
  var navItems = [
    { key: "dashboard", label: "대시보드", short: "홈", icon: <NavHome /> },
    { key: "mission", label: "미션 관리", short: "미션", icon: <NavList /> },
    { key: "members", label: "부원 관리", short: "부원", icon: <NavUser /> },
    { key: "certs", label: "인증 현황", short: "인증", icon: <NavCheck /> },
    { key: "uncert", label: "미인증자 관리", short: "미인증", icon: <NavWarn /> },
    { key: "history", label: "과거 미션", short: "기록", icon: <IconClipboard /> },
  ];
  var mobileMainNav = navItems.slice(0, 4);
  var mobileMoreNav = navItems.slice(4);

  useEffect(function() {
    if (props.initialTab) setTab(props.initialTab);
  }, [props.initialTab]);

  return (
    <div style={{
      minHeight: embedded ? "auto" : "100vh",
      background: embedded ? "linear-gradient(145deg,#e7f6fd 0%,#f8fcff 58%,#fff8da 100%)" : "#F7FAFF",
      borderRadius: embedded ? 24 : 0,
      overflow: embedded ? "hidden" : "visible",
      fontFamily: FONT,
      display: compactNav ? "block" : "flex"
    }}>
      {compactNav && (
        <div style={{
          position: embedded ? "relative" : "sticky",
          top: embedded ? "auto" : 0,
          zIndex: embedded ? 1 : 20,
          background: embedded ? "rgba(255,255,255,0.42)" : "rgba(247,250,255,0.98)",
          borderBottom: "1px solid #E5EAF2",
          padding: embedded ? "12px 10px 10px" : "10px 10px 8px",
          marginBottom: embedded ? 18 : 0,
          boxShadow: embedded ? "none" : "0 8px 24px rgba(33,64,120,0.05)",
          boxSizing: "border-box",
          width: "100%",
          overflow: "visible"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {!embedded && <img src={mastLogo} alt="MAST" style={{ width: 86, height: "auto", display: "block" }} />}
              <span style={{ fontSize: 11, fontWeight: 900, color: "#0869F4", background: "#E8F0FE", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>관리자</span>
            </div>
            {embedded && <button onClick={function() { if (props.onExitToAdmin) { props.onExitToAdmin(); } else { window.location.href = "/admin"; } }} style={{ border: "1px solid #D7E7F6", background: "rgba(255,255,255,0.76)", color: "#0869F4", borderRadius: 999, cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 900, padding: "6px 10px", whiteSpace: "nowrap" }}>관리자 메인</button>}
            {!embedded && <button onClick={props.onLogout} style={btnSmall({ width: "auto", background: "#fff", color: SUB, border: "1px solid #E5EAF2", borderRadius: 14, whiteSpace: "nowrap", padding: "7px 11px", fontSize: 11 })}>로그아웃</button>}
          </div>
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 5, background: "#EEF3FB", borderRadius: 16, padding: 4 }}>
            {mobileMainNav.map(function(it) {
              var active = tab === it.key;
              return (
                <button key={it.key} onClick={function() { setTab(it.key); setMoreOpen(false); }}
                  style={{ minWidth: 0, border: "none", borderRadius: 12, background: active ? "linear-gradient(145deg,#8bd7f8 0%,#3478f6 76%,#fff0a8 170%)" : "transparent", cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 2px", color: active ? "#fff" : "#4A5568", fontWeight: 900, fontSize: 11, whiteSpace: "nowrap", boxShadow: active ? "0 8px 16px rgba(8,105,244,0.16)" : "none", overflow: "hidden" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{it.short || it.label}</span>
                </button>
              );
            })}
            <button onClick={function() { setMoreOpen(!moreOpen); }}
              style={{ minWidth: 0, border: "none", borderRadius: 12, background: mobileMoreNav.some(function(it) { return it.key === tab; }) ? "linear-gradient(145deg,#8bd7f8 0%,#3478f6 76%,#fff0a8 170%)" : "transparent", cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 2px", color: mobileMoreNav.some(function(it) { return it.key === tab; }) ? "#fff" : "#4A5568", fontWeight: 900, fontSize: 15, whiteSpace: "nowrap" }}>···</button>
          </div>
          {moreOpen && (
            <div style={{ position: embedded ? "relative" : "absolute", right: embedded ? "auto" : 10, top: embedded ? "auto" : 92, zIndex: embedded ? 2 : 100, width: embedded ? "100%" : 146, marginTop: embedded ? 8 : 0, background: embedded ? "rgba(255,255,255,0.72)" : "#fff", border: "1px solid #E5EAF2", borderRadius: 14, boxShadow: embedded ? "none" : "0 14px 30px rgba(33,64,120,0.18)", padding: 6, display: embedded ? "grid" : "block", gridTemplateColumns: embedded ? "repeat(2, minmax(0, 1fr))" : undefined, gap: embedded ? 6 : 0, boxSizing: "border-box" }}>
              {mobileMoreNav.map(function(it) {
                return (
                  <button key={it.key} onClick={function() { setTab(it.key); setMoreOpen(false); }}
                    style={{ width: "100%", border: "none", background: tab === it.key ? "linear-gradient(145deg,#e7f6fd,#fff8da)" : "transparent", color: tab === it.key ? BLUE : INK, borderRadius: 10, padding: embedded ? "9px 8px" : "10px", textAlign: embedded ? "center" : "left", fontFamily: FONT, fontSize: 12, fontWeight: 900, cursor: "pointer" }}>{it.label}</button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div style={{ width: sidebarCollapsed ? 82 : 244, background: "linear-gradient(180deg,#082B66 0%,#061B43 100%)", color: "#fff", display: compactNav ? "none" : "flex", flexDirection: "column", minHeight: "100vh", padding: sidebarCollapsed ? "22px 10px" : "30px 16px", flexShrink: 0, boxShadow: "12px 0 32px rgba(6,27,67,0.16)", boxSizing: "border-box", transition: "width .18s ease, padding .18s ease" }}>
        <div style={{ padding: sidebarCollapsed ? "0 0 18px" : "0 24px 22px", display: "flex", flexDirection: "column", alignItems: sidebarCollapsed ? "center" : "flex-start" }}>
          <img src={mastLogo} alt="MAST" style={{ width: sidebarCollapsed ? 46 : 112, height: "auto", display: "block", filter: "brightness(0) invert(1)" }} />
          {!sidebarCollapsed && <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", fontWeight: 800, marginTop: 2 }}>관리자 페이지</div>}
          <button
            onClick={function() { setSidebarCollapsed(!sidebarCollapsed); }}
            title={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
            style={{ marginTop: 14, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "#fff", borderRadius: 999, cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 900, padding: sidebarCollapsed ? "6px 9px" : "6px 12px", letterSpacing: 0 }}
          >{sidebarCollapsed ? ">>>" : "<<<"}</button>
        </div>
        {navItems.map(function(it) {
          var active = tab === it.key;
          return (
            <button key={it.key} title={it.label} onClick={function() { setTab(it.key); }}
              style={{ border: "none", borderRadius: 10, background: active ? "linear-gradient(145deg,#8bd7f8 0%,#3478f6 76%,#fff0a8 170%)" : "transparent", cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "flex-start", gap: sidebarCollapsed ? 0 : 12, padding: sidebarCollapsed ? "14px 0" : "14px 14px", color: "#fff", fontWeight: active ? 900 : 700, fontSize: 15, textAlign: "left", width: "100%", marginBottom: 6, opacity: active ? 1 : 0.82 }}>
              <span style={{ display: "flex", color: "#fff" }}>{it.icon}</span>
              {!sidebarCollapsed && it.label}
            </button>
          );
        })}
        <div style={{ marginTop: "auto", padding: sidebarCollapsed ? 8 : "18px 12px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, color: "rgba(255,255,255,0.82)" }}>
          {!sidebarCollapsed && <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 6 }}>도움이 필요하신가요?</div>}
          <button title="로그아웃" onClick={props.onLogout} style={{ border: "none", background: "rgba(255,255,255,0.08)", borderRadius: 10, cursor: "pointer", fontFamily: FONT, color: "#fff", fontSize: 13, padding: sidebarCollapsed ? "9px 0" : "9px 12px", fontWeight: 800, width: "100%" }}>
            {sidebarCollapsed ? "OUT" : "로그아웃"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: embedded ? "8px 18px 24px" : compactNav ? "12px 8px 24px" : "26px 34px", overflow: "auto", minHeight: compactNav ? "auto" : "100vh", maxWidth: compactNav ? "100%" : 1440, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {tab === "dashboard" && <AdminDashboard onTab={setTab} embedded={embedded} />}
        {tab === "mission" && <AdminMission session={props.session} />}
        {tab === "history" && <AdminMissionHistory />}
        {tab === "members" && <AdminMembers />}
        {tab === "certs" && <AdminCerts />}
        {tab === "uncert" && <AdminUncert />}
      </div>
    </div>
  );
}

function AdminDashboard(props) {
  var embedded = !!props.embedded;
  var winW = useWindowWidth();
  var isMobile = winW < 768;
  var embeddedMobile = embedded && isMobile;
  var today = todayKST();
  var _mission = useState(null), mission = _mission[0], setMission = _mission[1];
  var _assignments = useState([]), assignments = _assignments[0], setAssignments = _assignments[1];
  var _members = useState([]), members = _members[0], setMembers = _members[1];
  var _loading = useState(true), loading = _loading[0], setLoading = _loading[1];
  var _cd = useState(""), cd = _cd[0], setCd = _cd[1];
  var _notifyBusy = useState(false), notifyBusy = _notifyBusy[0], setNotifyBusy = _notifyBusy[1];
  var _notifyMsg = useState(""), notifyMsg = _notifyMsg[0], setNotifyMsg = _notifyMsg[1];
  var nowMs = useNowMs(60000);

  async function handleNotifyTargets() {
    if (notifyBusy) return;
    setNotifyBusy(true); setNotifyMsg("");
    try {
      var assigneeRows = assignments.map(function(a) { return { member_id: a.member_id, member_name: a.member_name, gi: a.gi, school: a.school, status: a.status }; });
      var result = await notifyPromotionTargets({ mission: mission, assignees: assigneeRows });
      var msg = result.sent + "명에게 알림을 보냈습니다.";
      if (result.unmatched && result.unmatched.length) msg += " (미매칭 " + result.unmatched.length + "명: 로그인 계정과 연결되지 않음)";
      setNotifyMsg(msg);
    } catch (e) {
      setNotifyMsg(e.message || "알림 발송에 실패했습니다.");
    } finally {
      setNotifyBusy(false);
    }
  }

  var load = useCallback(async function() {
    setLoading(true);
    var r1 = await supabase.from("promotion_missions").select("*").eq("mission_date", today).maybeSingle();
    setMission(r1.data || null);
    if (r1.data) {
      var r2 = await supabase.from("promotion_assignment_status_view").select("*").eq("mission_id", r1.data.id);
      setAssignments(r2.data || []);
    } else {
      setAssignments([]);
    }
    var r3 = await supabase.from("members").select(LEGACY_MEMBER_FIELDS).eq("status", "active");
    setMembers(r3.data || []);
    setLoading(false);
  }, [today]);

  useEffect(function() { load(); }, [load]);

  useEffect(function() {
    if (!mission) return;
    function tick() {
      var now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
      var deadline = new Date(mission.due_at);
      var diff = deadline - now;
      if (diff <= 0) { setCd("마감"); return; }
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      setCd(String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0"));
    }
    tick();
    var timer = setInterval(tick, 1000);
    return function() { clearInterval(timer); };
  }, [mission]);

  if (loading) return <div style={{ color: SUB }}>불러오는 중...</div>;

  var assigneeMembers = assignments.map(function(a) { return { id: a.member_id, name: a.member_name, gi: a.gi, school: a.school, status: a.status, submitted_at: a.submitted_at }; });
  var approvedProofs = assigneeMembers.filter(function(p) { return p.status === ST.APPROVED || p.status === ST.LATE; });
  var pendingProofs = assigneeMembers.filter(function(p) { return p.status === ST.SUBMITTED; });
  var notSubmitted = assigneeMembers.filter(function(m) { return m.status === ST.PENDING || m.status === ST.MISSED || m.status === ST.REJECTED; });
  var missionPeriodText = mission ? fmtShortDate(today) + " ~ " + fmtShortDate(mission.due_at) + " " + fmtTime(mission.due_at) : "";
  var msToDue = mission && mission.due_at ? new Date(mission.due_at).getTime() - nowMs : null;
  var urgentDue = msToDue != null && msToDue > 0 && msToDue <= 60 * 60 * 1000;
  var heroSection = (
    <div style={{ position: "relative", minHeight: embeddedMobile ? 232 : isMobile ? 194 : 176, overflow: "visible", padding: embeddedMobile ? "4px 14px 14px" : isMobile ? 0 : "28px 26px 26px 184px", background: "transparent", boxSizing: "border-box", marginBottom: embedded ? 14 : 20 }}>
      <div style={{ position: "absolute", zIndex: 0, inset: embeddedMobile ? "-72px -34px -56px -34px" : "-70px -42px -58px -42px", background: "radial-gradient(circle at 72% 34%, rgba(190,225,255,.64), transparent 38%), radial-gradient(circle at 18% 24%, rgba(255,235,160,.24), transparent 34%)", pointerEvents: "none" }} />
      <img src={assets.hero.megaphone} alt="" style={{ position: "absolute", zIndex: 1, left: embeddedMobile ? -22 : isMobile ? -22 : 5, top: "auto", bottom: embeddedMobile ? 4 : isMobile ? -52 : -70, width: embeddedMobile ? 166 : isMobile ? 205 : 247, height: "auto", objectFit: "contain", transform: "rotate(-2deg)", opacity: 0.88, pointerEvents: "none" }} />
      <div style={embeddedMobile ? { position: "relative", zIndex: 2, marginLeft: 126, minHeight: 168, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" } : isMobile ? { position: "absolute", zIndex: 2, left: 118, right: 10, top: 24, bottom: 18, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" } : { position: "relative", zIndex: 2, minWidth: 0 }}>
        <div style={{ width: embeddedMobile ? "calc(100vw - 42px)" : "auto", marginLeft: embeddedMobile ? -126 : 0, fontSize: fitFontSize("오늘 홍보 미션 · " + fmtShortDate(today), isMobile ? 16 : 22, 12, isMobile ? 11 : 14, 4), lineHeight: isMobile ? "21px" : "28px", color: "#0869F4", fontWeight: 900, marginBottom: isMobile ? 7 : 8, whiteSpace: "normal", wordBreak: "keep-all", textAlign: "center" }}>오늘 홍보 미션 · {fmtShortDate(today)}</div>
        <div style={{ width: embeddedMobile ? "calc(100vw - 42px)" : "auto", marginLeft: embeddedMobile ? -126 : 0, fontSize: fitFontSize(mission ? mission.title : "등록된 미션이 없습니다", embeddedMobile ? 17 : isMobile ? 18 : 24, isMobile ? 14 : 17, isMobile ? 8 : 14, 5), lineHeight: embeddedMobile ? "23px" : isMobile ? "24px" : "32px", fontWeight: 900, color: "#071C59", marginBottom: mission ? 8 : 0, wordBreak: "keep-all", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: embeddedMobile ? 2 : 2, WebkitBoxOrient: "vertical", textAlign: "center" }}>{mission ? mission.title : "등록된 미션이 없습니다"}</div>
        {mission && <div style={{ fontSize: isMobile ? 12 : 15, color: "#071C59", fontWeight: 800, lineHeight: 1.45, wordBreak: "keep-all" }}>미션 기간 {missionPeriodText}</div>}
        {mission && <div style={{ display: "inline-flex", marginTop: 8, borderRadius: 999, background: urgentDue ? "#FFF1F1" : "#E8F8F2", color: urgentDue ? "#E04848" : "#00A879", padding: "6px 10px", fontSize: isMobile ? 12 : 14, fontWeight: 900, animation: urgentDue ? "mastSirenBlink .8s infinite" : "none" }}>마감까지 {cd}</div>}
        <button onClick={function() { props.onTab("mission"); }} style={btnPrimary({ width: embeddedMobile ? 120 : isMobile ? 112 : 144, height: isMobile ? 38 : 48, padding: 0, borderRadius: 10, fontSize: isMobile ? 13 : 16, marginTop: embeddedMobile ? 10 : isMobile ? "auto" : 16, alignSelf: "center" })}>{mission ? "미션 수정" : "미션 등록"}</button>
      </div>
    </div>
  );
  var missingSection = (
    <div style={{ marginBottom: 20 }}>
      <ListPanel title={<span>제출대기 {pendingProofs.length} · 미제출 {notSubmitted.length} <span style={{ marginLeft: 8, color: urgentDue ? "#E04848" : "#00A879", animation: urgentDue ? "mastSirenBlink .8s infinite" : "none" }}>마감까지 {cd}</span></span>} titleColor="#E04848">
        {pendingProofs.map(function(p) {
          return <ListRow key={p.id} name={p.name} sub={p.school + " · 검토 대기"} badge={<span style={{ fontSize: 11, color: BLUE, fontWeight: 900 }}>제출</span>} onClick={function() { props.onTab("certs"); }} />;
        })}
        {notSubmitted.map(function(m) {
          return <ListRow key={keyOf(m)} name={m.name} sub={m.school + " · 미제출"} badge={<span style={{ fontSize: 11, color: "#E04848", fontWeight: 900 }}>미제출</span>} />;
        })}
        {pendingProofs.length === 0 && notSubmitted.length === 0 && <Empty />}
      </ListPanel>
    </div>
  );
  var todayTargetsSection = (
    <div style={{ marginBottom: 20 }}>
      <ListPanel title={"오늘 대상자 (총 " + assigneeMembers.length + "명)"}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 14 }}>
          {assigneeMembers.map(function(m) {
            return (
              <div key={keyOf(m)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 56 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#3B72E8,#5A8EF5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>{m.name.slice(0, 1)}</div>
                <div style={{ fontSize: 11, textAlign: "center", color: INK, fontWeight: 700 }}>{m.name}</div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={handleNotifyTargets}
            disabled={notifyBusy || !mission || assigneeMembers.length === 0}
            style={btnPrimary({ width: "100%", height: 44, padding: 0, borderRadius: 10, fontSize: 14, opacity: (notifyBusy || !mission || assigneeMembers.length === 0) ? 0.55 : 1 })}>
            {notifyBusy ? "알림 보내는 중..." : "대상자에게 알림 보내기"}
          </button>
          {notifyMsg && <div style={{ fontSize: 12, color: "#42506A", fontWeight: 700, textAlign: "center", wordBreak: "keep-all" }}>{notifyMsg}</div>}
        </div>
      </ListPanel>
    </div>
  );
  var secondaryDashboardSection = (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.2fr 1fr", gap: 16, marginBottom: 20 }}>
      <div style={card({ padding: 0, display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", overflow: "hidden" })}>
        <DashMetric label="전체 학교" value={new Set(members.map(function(m) { return m.school; })).size} unit="개" icon={<NavUser />} color="#0869F4" compact={isMobile} onClick={function() { props.onTab("history"); }} />
        <DashMetric label={mission ? "미션 수정" : "미션 등록"} value={assigneeMembers.length} unit="명" icon={<NavUser />} color="#00A879" compact={isMobile} onClick={function() { props.onTab("mission"); }} />
        <DashMetric label="제출 완료" value={approvedProofs.length} unit="명" sub={assigneeMembers.length ? Math.round(approvedProofs.length / assigneeMembers.length * 100) + "%" : "0%"} icon={<IconCheck color="#00A879" />} color="#00A879" compact={isMobile} onClick={function() { props.onTab("certs"); }} />
        <DashMetric label="미제출" value={notSubmitted.length} unit="명" sub={assigneeMembers.length ? Math.round(notSubmitted.length / assigneeMembers.length * 100) + "%" : "0%"} icon={<NavWarn />} color="#FF5A1F" compact={isMobile} onClick={function() { props.onTab("uncert"); }} />
      </div>
      <ListPanel title={"인증 완료 (" + approvedProofs.length + "명)"} titleColor="#10A26A">
        {approvedProofs.length === 0 ? <Empty /> : approvedProofs.map(function(p) {
          return <ListRow key={p.id} name={p.name} sub={fmtTime(p.submitted_at) + " 인증"} badge={<IconCheck color="#10A26A" />} />;
        })}
      </ListPanel>
    </div>
  );

  return (
    <div>
      <style>{"@keyframes mastSirenBlink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.38;transform:scale(1.04)}}"}</style>
      {!embedded && <div style={{ fontSize: 15, color: "#42506A", fontWeight: 800, marginBottom: 4 }}>홍보 운영 현황</div>}
      {!embedded && <div style={{ fontSize: isMobile ? 24 : 30, lineHeight: 1.22, wordBreak: "keep-all", letterSpacing: "-0.05em", fontWeight: 900, color: "#071C59", marginBottom: 22 }}>오늘 미션과 인증 상태를 확인해요</div>}

      {heroSection}
      {missingSection}
      {todayTargetsSection}
      {secondaryDashboardSection}

      <div style={{ display: "none", gridTemplateColumns: isMobile ? "1fr" : "1.2fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={card({ padding: 0, display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", overflow: "hidden" })}>
          <DashMetric label="전체 학교" value={new Set(members.map(function(m) { return m.school; })).size} unit="개" icon={<NavUser />} color="#0869F4" compact={isMobile} onClick={function() { props.onTab("history"); }} />
          <DashMetric label={mission ? "미션 수정" : "미션 등록"} value={assigneeMembers.length} unit="명" icon={<NavUser />} color="#00A879" compact={isMobile} onClick={function() { props.onTab("mission"); }} />
          <DashMetric label="제출 완료" value={approvedProofs.length} unit="명" sub={assigneeMembers.length ? Math.round(approvedProofs.length / assigneeMembers.length * 100) + "%" : "0%"} icon={<IconCheck color="#00A879" />} color="#00A879" compact={isMobile} onClick={function() { props.onTab("certs"); }} />
          <DashMetric label="미제출" value={notSubmitted.length} unit="명" sub={assigneeMembers.length ? Math.round(notSubmitted.length / assigneeMembers.length * 100) + "%" : "0%"} icon={<NavWarn />} color="#FF5A1F" compact={isMobile} onClick={function() { props.onTab("uncert"); }} />
        </div>
        <div style={{ position: "relative", minHeight: isMobile ? 214 : 176, overflow: "hidden", padding: isMobile ? 0 : "28px 26px 26px 184px", background: "transparent", boxSizing: "border-box" }}>
          <img src={assets.hero.megaphone} alt="" style={{ position: "absolute", zIndex: 0, left: isMobile ? 10 : 5, top: "auto", bottom: isMobile ? -90 : -70, width: isMobile ? 286 : 247, height: "auto", objectFit: "contain", transform: "rotate(-2deg)", opacity: 0.98, pointerEvents: "none" }} />
          <div style={isMobile ? { position: "absolute", zIndex: 2, left: 150, right: 16, top: 24, bottom: 20, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" } : { position: "relative", zIndex: 2, minWidth: 0 }}>
            <div style={{ fontSize: fitFontSize("오늘 홍보 미션 · " + fmtShortDate(today), isMobile ? 19 : 22, 13, isMobile ? 12 : 14, 4), lineHeight: isMobile ? "24px" : "28px", color: "#0869F4", fontWeight: 900, marginBottom: isMobile ? 10 : 8, whiteSpace: "normal", wordBreak: "keep-all" }}>오늘 홍보 미션 · {fmtShortDate(today)}</div>
            <div style={{ fontSize: fitFontSize(mission ? mission.title : "등록된 미션이 없습니다", isMobile ? 18 : 20, isMobile ? 12 : 14, isMobile ? 9 : 14, 5), lineHeight: isMobile ? "23px" : "27px", fontWeight: 900, color: "#071C59", marginBottom: mission ? 8 : 0, wordBreak: "keep-all", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: mission ? 2 : 1, WebkitBoxOrient: "vertical" }}>{mission ? mission.title : "등록된 미션이 없습니다"}</div>
            {mission && <div style={{ fontSize: isMobile ? 12 : 15, color: "#071C59", fontWeight: 800, lineHeight: 1.45, wordBreak: "keep-all" }}>미션 기간 {missionPeriodText}</div>}
            {mission && <div style={{ display: "inline-flex", marginTop: 8, borderRadius: 999, background: urgentDue ? "#FFF1F1" : "#E8F8F2", color: urgentDue ? "#E04848" : "#00A879", padding: "6px 10px", fontSize: isMobile ? 12 : 14, fontWeight: 900, animation: urgentDue ? "mastSirenBlink .8s infinite" : "none" }}>마감까지 {cd}</div>}
            <button onClick={function() { props.onTab("mission"); }} style={btnPrimary({ width: isMobile ? 124 : 144, height: isMobile ? 42 : 48, padding: 0, borderRadius: 10, fontSize: isMobile ? 15 : 16, marginTop: isMobile ? "auto" : 16, alignSelf: "center" })}>{mission ? "미션 수정" : "미션 등록"}</button>
          </div>
        </div>
      </div>

      <div style={{ display: "none", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: isMobile ? 10 : 16, marginBottom: 20 }}>
        <ListPanel title={"인증 완료 (" + approvedProofs.length + "명)"} titleColor="#10A26A">
          {approvedProofs.length === 0 ? <Empty /> : approvedProofs.map(function(p) {
            return <ListRow key={p.id} name={p.name} sub={fmtTime(p.submitted_at) + " 인증"} badge={<IconCheck color="#10A26A" />} />;
          })}
        </ListPanel>

        <ListPanel title={<span>제출됨 {pendingProofs.length} · 미제출 {notSubmitted.length} <span style={{ marginLeft: 8, color: urgentDue ? "#E04848" : "#00A879", animation: urgentDue ? "mastSirenBlink .8s infinite" : "none" }}>마감까지 {cd}</span></span>} titleColor="#E04848">
          {pendingProofs.map(function(p) {
            return <ListRow key={p.id} name={p.name} sub={p.school + " · 검토 대기"} badge={<span style={{ fontSize: 11, color: BLUE, fontWeight: 900 }}>제출</span>} onClick={function() { props.onTab("certs"); }} />;
          })}
          {notSubmitted.map(function(m) {
            return <ListRow key={keyOf(m)} name={m.name} sub={m.school + " · 미제출"} badge={<span style={{ fontSize: 11, color: "#E04848", fontWeight: 900 }}>미제출</span>} />;
          })}
          {pendingProofs.length === 0 && notSubmitted.length === 0 && <Empty />}
        </ListPanel>

        <ListPanel title={"오늘 대상자 (총 " + assigneeMembers.length + "명)"}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 14 }}>
            {assigneeMembers.map(function(m) {
              return (
                <div key={keyOf(m)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 56 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#3B72E8,#5A8EF5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>{m.name.slice(0, 1)}</div>
                  <div style={{ fontSize: 11, textAlign: "center", color: INK, fontWeight: 700 }}>{m.name}</div>
                </div>
              );
            })}
          </div>
        </ListPanel>
      </div>

      <div style={{ display: "none" }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>빠른 기능</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 12 }}>
          {[
            { icon: <IconClipboard />, label: "미션 생성", tab: "mission" },
            { icon: <IconUsers />, label: "부원 관리", tab: "members" },
            { icon: <IconSiren />, label: "미인증자 보기", tab: "uncert" },
            { icon: <IconCheckCircle />, label: "인증 현황", tab: "certs" },
          ].map(function(q) {
            return (
              <button key={q.tab} onClick={function() { props.onTab(q.tab); }}
                style={{ border: "1px solid #E5EAF2", borderRadius: 14, padding: isMobile ? "14px 8px" : "18px 12px", background: "#F8FAFF", cursor: "pointer", fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                {q.icon}
                <span style={{ fontSize: 12, fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>{q.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListPanel(props) {
  return (
    <div style={card({ padding: 0, overflow: "hidden" })}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #F1F4F9" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: props.titleColor || INK }}>{props.title}</span>
      </div>
      {props.children}
    </div>
  );
}
function ListRow(props) {
  return (
    <div onClick={props.onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", borderTop: "1px solid #F1F4F9", cursor: props.onClick ? "pointer" : "default" }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#EEF3FB", display: "flex", alignItems: "center", justifyContent: "center", color: BLUE, fontWeight: 800, fontSize: 13 }}>{props.name.slice(0, 1)}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{props.name}</div>
        <div style={{ fontSize: 11, color: SUB }}>{props.sub}</div>
      </div>
      <span style={{ fontSize: 16, display: "flex", alignItems: "center" }}>{props.badge}</span>
    </div>
  );
}
function Empty() { return <div style={{ padding: 18, fontSize: 13, color: SUB, textAlign: "center" }}>없음</div>; }
function DashMetric(props) {
  var compact = props.compact;
  return (
    <button onClick={props.onClick} style={{ padding: compact ? "13px 8px" : 26, border: "none", borderRight: "1px solid #E9EEF7", borderBottom: compact ? "1px solid #E9EEF7" : "none", minHeight: compact ? 118 : 120, boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", background: "#fff", fontFamily: FONT, cursor: "pointer" }}>
      <div style={{ width: compact ? 34 : 42, height: compact ? 34 : 42, borderRadius: "50%", background: props.color === "#FF5A1F" ? "#FFF1EA" : props.color === "#00A879" ? "#E9FAF4" : "#EEF5FF", color: props.color, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: compact ? 8 : 10 }}>{props.icon}</div>
      <div style={{ fontSize: compact ? 12 : 14, lineHeight: compact ? "16px" : "19px", fontWeight: 900, color: "#42506A", marginBottom: compact ? 5 : 8, whiteSpace: "nowrap" }}>{props.label}</div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 3, color: "#071C59", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: compact ? 28 : 28, lineHeight: compact ? "31px" : "34px", fontWeight: 900 }}>{props.value}</span>
        <span style={{ fontSize: compact ? 16 : 16, fontWeight: 900 }}>{props.unit}</span>
      </div>
      {props.sub && <div style={{ fontSize: compact ? 12 : 14, color: props.color, fontWeight: 900, marginTop: 2 }}>{props.sub}</div>}
    </button>
  );
}

/* ─── 관리자 미션 관리 (수정·삭제 포함) ─── */
function AdminMission(props) {
  var winW = useWindowWidth();
  var isMobile = winW < 768;
  var today = todayKST();
  var _mission = useState(null), mission = _mission[0], setMission = _mission[1];
  var _members = useState([]), members = _members[0], setMembers = _members[1];
  var _title = useState(""), title = _title[0], setTitle = _title[1];
  var _body = useState(""), body = _body[0], setBody = _body[1];
  var _postTitle = useState(""), postTitle = _postTitle[0], setPostTitle = _postTitle[1];
  var _postBody = useState(""), postBody = _postBody[0], setPostBody = _postBody[1];
  var _deadlineDate = useState(addDaysKST(today, 1)), deadlineDate = _deadlineDate[0], setDeadlineDate = _deadlineDate[1];
  var _deadline = useState("02:00"), deadline = _deadline[0], setDeadline = _deadline[1];
  var _selected = useState(new Set()), selected = _selected[0], setSelected = _selected[1];
  var _query = useState(""), query = _query[0], setQuery = _query[1];
  var _rotationCount = useState(5), rotationCount = _rotationCount[0], setRotationCount = _rotationCount[1];
  var _lastRotationMemberId = useState(""), lastRotationMemberId = _lastRotationMemberId[0], setLastRotationMemberId = _lastRotationMemberId[1];
  var _prevAssignmentIds = useState(new Set()), prevAssignmentIds = _prevAssignmentIds[0], setPrevAssignmentIds = _prevAssignmentIds[1];
  var _assignmentHistory = useState([]), assignmentHistory = _assignmentHistory[0], setAssignmentHistory = _assignmentHistory[1];
  var _rotationHint = useState(""), rotationHint = _rotationHint[0], setRotationHint = _rotationHint[1];
  var _rotationReady = useState(false), rotationReady = _rotationReady[0], setRotationReady = _rotationReady[1];
  var _autoPickApplied = useState(false), autoPickApplied = _autoPickApplied[0], setAutoPickApplied = _autoPickApplied[1];
  var _busy = useState(false), busy = _busy[0], setBusy = _busy[1];
  var _msg = useState(""), msg = _msg[0], setMsg = _msg[1];
  var _imgFile = useState(null), imgFile = _imgFile[0], setImgFile = _imgFile[1];
  var _imgPreview = useState(null), imgPreview = _imgPreview[0], setImgPreview = _imgPreview[1];
  var _previewOpen = useState(false), previewOpen = _previewOpen[0], setPreviewOpen = _previewOpen[1];
  var _missingOpen = useState(false), missingOpen = _missingOpen[0], setMissingOpen = _missingOpen[1];
  var _draftMsg = useState(""), draftMsg = _draftMsg[0], setDraftMsg = _draftMsg[1];
  var imgRef = useRef(null);

  function inferLastRotationMember(prevAssignments, orderedMembers) {
    if (!prevAssignments.length || !orderedMembers.length) return "";
    var selectedMap = {};
    prevAssignments.forEach(function(a) { selectedMap[a.member_id] = true; });
    var count = prevAssignments.length;
    for (var i = 0; i < orderedMembers.length; i++) {
      var prev = (i - 1 + orderedMembers.length) % orderedMembers.length;
      if (selectedMap[orderedMembers[i].id] && !selectedMap[orderedMembers[prev].id]) {
        return orderedMembers[(i + count - 1) % orderedMembers.length].id;
      }
    }
    for (var j = orderedMembers.length - 1; j >= 0; j--) {
      if (selectedMap[orderedMembers[j].id]) return orderedMembers[j].id;
    }
    return "";
  }

  function buildAutoSchoolPick() {
    var activeMembers = members.filter(function(m) { return (m.status || "active") === "active"; });
    if (!activeMembers.length) return { ids: [], skipped: [] };
    var schoolMap = {};
    activeMembers.forEach(function(m) {
      var key = schoolKey(m.school);
      if (!schoolMap[key]) schoolMap[key] = { school: m.school, members: [] };
      schoolMap[key].members.push(m);
    });
    var picks = [];
    var skipped = [];
    Object.values(schoolMap).sort(function(a, b) {
      return String(a.school || "").localeCompare(String(b.school || ""), "ko");
    }).forEach(function(group) {
      var sorted = sortMembersByKoreanName(group.members);
      var history = schoolRotationHistory(assignmentHistory, group.school);
      var last = history[0] || null;
      var pick = null;
      if (!isSchoolRotationDue(group.school, history, today)) {
        skipped.push(group.school + " 없음(" + promotionIntervalDays(group.school) + "일 주기)");
      } else if (!last) {
        pick = sorted[0];
      } else {
        var lastIndex = sorted.findIndex(function(m) { return m.id === last.member_id; });
        pick = sorted[(lastIndex + 1 + sorted.length) % sorted.length];
      }
      if (pick) picks.push(pick.id);
    });
    return { ids: picks, skipped: skipped };
  }

  function applyRotationPick() {
    if (!rotationReady) { setMsg("배정 이력을 불러오는 중입니다. 잠시 후 다시 시도해 주세요."); return; }
    if (!members.length) { setMsg("선택할 회원이 없습니다."); return; }
    var result = buildAutoSchoolPick();
    setSelected(new Set(result.ids));
    setQuery("");
    setAutoPickApplied(true);
    setRotationHint("학교별 자동 추천: " + result.ids.length + "명" + (result.skipped.length ? " · 제외 " + result.skipped.length + "개 학교" : ""));
  }

  function toggleSelectedMember(memberId) {
    setSelected(function(prev) {
      var n = new Set(prev);
      if (n.has(memberId)) n.delete(memberId);
      else n.add(memberId);
      return n;
    });
  }

  var load = useCallback(async function() {
    setRotationReady(false);
    try {
    var r1 = await supabase.from("promotion_missions").select("*").eq("mission_date", today).maybeSingle();
    if (r1.error) throw r1.error;
    if (r1.data) {
      setMission(r1.data);
      setTitle(r1.data.title || "");
      setBody(r1.data.body && (r1.data.post_body || r1.data.post_title) ? r1.data.body : "");
      setPostTitle(postTitleOf(r1.data));
      setPostBody(postBodyOf(r1.data));
      setDeadlineDate(r1.data.due_at ? new Date(r1.data.due_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) : addDaysKST(today, 1));
      setDeadline(r1.data.due_at ? inputTimeFromIsoKST(r1.data.due_at) : "02:00");
      var ar = await supabase.from("promotion_mission_assignments").select("member_id").eq("mission_id", r1.data.id);
      if (ar.error) throw ar.error;
      setSelected(new Set((ar.data || []).map(function(a) { return a.member_id; })));
      setAutoPickApplied(true);
      if (r1.data.mission_image_url) setImgPreview(r1.data.mission_image_url);
    } else {
      setMission(null); setTitle(""); setBody(""); setPostTitle(""); setPostBody(""); setDeadlineDate(addDaysKST(today, 1)); setDeadline("02:00"); setSelected(new Set()); setImgPreview(null); setAutoPickApplied(false);
    }
    var r2 = await supabase.from("members").select(LEGACY_MEMBER_FIELDS).eq("status", "active");
    if (r2.error) throw r2.error;
    var memberRows = sortMembersForRotation(r2.data || []);
    setMembers(memberRows);
    var r3 = await supabase.from("promotion_missions").select("*").lt("mission_date", today).order("mission_date", { ascending: false }).limit(10);
    var historyRes = await supabase.from("promotion_assignment_status_view").select("member_id, member_name, gi, school, mission_date, status").lt("mission_date", today).order("mission_date", { ascending: false });
    if (historyRes.error) throw historyRes.error;
    setAssignmentHistory((historyRes.data || []).filter(isPromotionTarget));
    if (r3.data && r3.data.length && memberRows.length) {
      var prev = await supabase.from("promotion_mission_assignments").select("member_id").eq("mission_id", r3.data[0].id);
      var prevRows = prev.data || [];
      setPrevAssignmentIds(new Set(prevRows.map(function(a) { return a.member_id; })));
      var inferred = inferLastRotationMember(prevRows, memberRows);
      if (inferred) {
        setLastRotationMemberId(inferred);
        var lastMember = memberRows.find(function(m) { return m.id === inferred; });
        if (lastMember) setRotationHint("과거 배정 이력을 불러왔습니다. 학교별 자동 선택을 눌러 추천 대상을 확인하세요.");
      }
    } else {
      setPrevAssignmentIds(new Set());
      setRotationHint("");
    }
    setRotationReady(true);
    } catch (error) { setMsg("배정 정보를 불러오지 못했습니다. 새로고침해 주세요."); }
  }, [today]);

  useEffect(function() { load(); }, [load]);

  useEffect(function() {
    if (!rotationReady || mission || autoPickApplied || !members.length) return;
    var result = buildAutoSchoolPick();
    setSelected(new Set(result.ids));
    setAutoPickApplied(true);
    setRotationHint("학교별 자동 추천: " + result.ids.length + "명" + (result.skipped.length ? " · 제외 " + result.skipped.length + "개 학교" : ""));
  }, [rotationReady, mission, autoPickApplied, members, assignmentHistory]);

  var filtered = query.trim() ? members.filter(function(m) { return m.name.includes(query) || m.school.includes(query) || m.gi.includes(query); }) : members;
  var selectedMembers = members.filter(function(m) { return selected.has(m.id); });
  var selectedSchoolKeys = Array.from(new Set(selectedMembers.map(function(m) { return schoolKey(m.school); })));
  var oneMemberSchools = Array.from(new Set(members.filter(function(m) {
    return members.filter(function(x) { return schoolKey(x.school) === schoolKey(m.school); }).length === 1;
  }).map(function(m) { return m.school; })));
  var twoMemberSchools = Array.from(new Set(members.filter(function(m) {
    return members.filter(function(x) { return schoolKey(x.school) === schoolKey(m.school); }).length === 2;
  }).map(function(m) { return m.school; })));
  var schoolPreviewRows = selectedSchoolKeys.map(function(key) {
    var schoolMembers = sortMembersByKoreanName(members.filter(function(m) { return schoolKey(m.school) === key; }));
    var school = schoolMembers[0] ? schoolMembers[0].school : key;
    var todayMembers = selectedMembers.filter(function(m) { return schoolKey(m.school) === key; });
    var lastSelected = todayMembers[todayMembers.length - 1];
    var next = null;
    if (schoolMembers.length && lastSelected) {
      var idx = schoolMembers.findIndex(function(m) { return m.id === lastSelected.id; });
      if (schoolMembers.length === 1) {
        next = null;
      } else if (schoolMembers.length === 2) {
        next = idx === 0 ? schoolMembers[1] : null;
      } else {
        next = schoolMembers[(idx + 1) % schoolMembers.length];
      }
    }
    return { school: school, count: schoolMembers.length, members: schoolMembers, today: todayMembers, next: next };
  }).sort(function(a, b) {
    return String(a.school || "").localeCompare(String(b.school || ""), "ko");
  });
  var missingRotationRows = Object.values(members.filter(function(m) {
    return (m.status || "active") === "active";
  }).reduce(function(map, m) {
    var key = schoolKey(m.school);
    if (!map[key]) map[key] = { school: m.school, members: [] };
    map[key].members.push(m);
    return map;
  }, {})).map(function(group) {
    var sorted = sortMembersByKoreanName(group.members);
    if (sorted.length < 3) return null;
    var history = assignmentHistory.filter(function(a) {
      return schoolKey(a.school) === schoolKey(group.school);
    }).slice().sort(function(a, b) {
      return String(a.mission_date || "").localeCompare(String(b.mission_date || ""));
    });
    if (!history.length) return null;
    var skippedMap = {};
    var orderIndex = {};
    sorted.forEach(function(m, idx) { orderIndex[m.id] = idx; });
    function addSkippedBetween(prevId, nextId, reason) {
      var prevIndex = orderIndex[prevId];
      var nextIndex = orderIndex[nextId];
      if (prevIndex == null || nextIndex == null || prevIndex === nextIndex) return;
      var expected = (prevIndex + 1) % sorted.length;
      if (expected === nextIndex) return;
      var cursor = expected;
      var guard = 0;
      while (cursor !== nextIndex && guard < sorted.length) {
        var skippedMember = sorted[cursor];
        skippedMap[skippedMember.id] = Object.assign({}, skippedMember, { skip_reason: reason });
        cursor = (cursor + 1) % sorted.length;
        guard += 1;
      }
    }
    for (var hi = 1; hi < history.length; hi++) {
      addSkippedBetween(
        history[hi - 1].member_id,
        history[hi].member_id,
        fmtShortDate(history[hi].mission_date) + " 배정 전 순서 건너뜀"
      );
    }
    var todaySelected = sorted.filter(function(m) { return selected.has(m.id); });
    if (todaySelected.length) {
      var last = history[history.length - 1];
      addSkippedBetween(last.member_id, todaySelected[0].id, "오늘 선택에서 순서 건너뜀");
    }
    var candidates = Object.values(skippedMap).sort(function(a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), "ko");
    });
    if (!candidates.length) return null;
    return {
      school: group.school,
      candidates: candidates,
      members: sorted.map(function(m, idx) { return Object.assign({}, m, { order_no: idx + 1 }); })
    };
  }).filter(Boolean).sort(function(a, b) {
    return String(a.school || "").localeCompare(String(b.school || ""), "ko");
  });
  var missingCandidateCount = missingRotationRows.reduce(function(sum, row) { return sum + row.candidates.length; }, 0);

  function pickImage(e) {
    var f = e.target.files ? e.target.files[0] : null;
    if (!f) return;
    setImgFile(f);
    var reader = new FileReader();
    reader.onload = function() { setImgPreview(reader.result); };
    reader.readAsDataURL(f);
  }

  function saveDraft() {
    var draft = {
      title: title,
      body: body,
      postTitle: postTitle,
      postBody: postBody,
      deadlineDate: deadlineDate,
      deadline: deadline,
      selectedIds: Array.from(selected),
      lastRotationMemberId: lastRotationMemberId,
      rotationCount: rotationCount,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem("mast_admin_mission_draft_" + today, JSON.stringify(draft));
    setDraftMsg("임시저장되었습니다.");
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem("mast_admin_mission_draft_" + today);
      if (!raw) { setDraftMsg("불러올 임시저장이 없습니다."); return; }
      var draft = JSON.parse(raw);
      setTitle(draft.title || "");
      setBody(draft.body || "");
      setPostTitle(draft.postTitle || "");
      setPostBody(draft.postBody || "");
      setDeadlineDate(draft.deadlineDate || addDaysKST(today, 1));
      setDeadline(draft.deadline || "02:00");
      setSelected(new Set(draft.selectedIds || []));
      setLastRotationMemberId(draft.lastRotationMemberId || "");
      setRotationCount(draft.rotationCount || 5);
      setDraftMsg("임시저장을 불러왔습니다.");
    } catch(e) {
      setDraftMsg("임시저장을 불러오지 못했습니다.");
    }
  }

  async function save() {
    if (!rotationReady) { setMsg("배정 정보를 불러온 후 저장해 주세요."); return; }
    if (!title.trim() || !postTitle.trim() || selected.size === 0) { setMsg("미션명, 게시글 제목, 담당자를 입력해 주세요."); return; }
    setBusy(true); setMsg("");
    try {
      var dueAt = exactIsoKST(deadlineDate, deadline);
      var lateUntilAt = new Date(new Date(dueAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
      var row = { mission_date: today, title: title.trim(), body: body.trim() || null, post_title: postTitle.trim(), post_body: postBody.trim() || null, due_at: dueAt, late_until_at: lateUntilAt, status: "active", created_by: props.session.member.name };

      if (imgFile) {
        if (mission && mission.mission_image_path) {
          await supabase.storage.from(MISSION_BUCKET).remove([mission.mission_image_path]);
        }
        var ext = (imgFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        var path = today + "_" + Date.now() + "." + ext;
        var upRes = await supabase.storage.from(MISSION_BUCKET).upload(path, imgFile, { upsert: true });
        if (upRes.error) throw upRes.error;
        row.mission_image_url = supabase.storage.from(MISSION_BUCKET).getPublicUrl(path).data.publicUrl;
        row.mission_image_path = path;
      }

      var r;
      if (mission) {
        r = await supabase.from("promotion_missions").update(row).eq("id", mission.id).select("*").single();
      } else {
        r = await supabase.from("promotion_missions").upsert(row, { onConflict: "mission_date" }).select("*").single();
      }
      if (r.error) throw r.error;
      var savedMission = r.data;
      var selectedIds = Array.from(selected);
      var existing = await supabase.from("promotion_mission_assignments").select("id, member_id").eq("mission_id", savedMission.id);
      var existingRows = existing.data || [];
      var removeIds = existingRows.filter(function(a) { return selectedIds.indexOf(a.member_id) === -1; }).map(function(a) { return a.id; });
      if (removeIds.length) {
        var del = await supabase.from("promotion_mission_assignments").delete().in("id", removeIds);
        if (del.error) throw del.error;
      }
      var existingMemberIds = existingRows.map(function(a) { return a.member_id; });
      var keepIds = existingRows.filter(function(a) { return selectedIds.indexOf(a.member_id) !== -1; }).map(function(a) { return a.id; });
      if (keepIds.length) {
        var updAssign = await supabase.from("promotion_mission_assignments").update({ due_at: dueAt, late_until_at: lateUntilAt }).in("id", keepIds);
        if (updAssign.error) throw updAssign.error;
      }
      var insertRows = selectedIds.filter(function(id) { return existingMemberIds.indexOf(id) === -1; }).map(function(id) {
        return { mission_id: savedMission.id, member_id: id, status: ST.PENDING, due_at: dueAt, late_until_at: lateUntilAt, status_reason: "Assigned by admin" };
      });
      if (insertRows.length) {
        var ins = await supabase.from("promotion_mission_assignments").insert(insertRows);
        if (ins.error) throw ins.error;
      }
      setMsg("저장되었습니다. 전 부원에게 공개됩니다.");
      setImgFile(null);
      await load();
    } catch(e) { setMsg("저장 중 오류가 발생했습니다: " + e.message); console.error(e); }
    finally { setBusy(false); }
  }

  async function removeImage() {
    if (!mission || !mission.mission_image_path) {
      setImgFile(null); setImgPreview(null); return;
    }
    if (!confirm("미션 첨부 이미지를 삭제하시겠습니까?")) return;
    await supabase.storage.from(MISSION_BUCKET).remove([mission.mission_image_path]);
    await supabase.from("promotion_missions").update({ mission_image_url: null, mission_image_path: null }).eq("id", mission.id);
    setImgFile(null); setImgPreview(null);
    await load();
  }

  async function deleteMission(m) {
    if (!confirm("미션 \"" + m.title + "\" 을(를) 완전히 삭제하시겠습니까?\n관련된 부원들의 인증 기록도 모두 삭제됩니다.")) return;
    // 1. 미션 이미지 삭제
    if (m.mission_image_path) {
      await supabase.storage.from(MISSION_BUCKET).remove([m.mission_image_path]);
    }
    // 2. 인증 사진들 삭제
    var proofs = await supabase.from("promotion_proofs").select("proof_file_path").eq("mission_id", m.id);
    var paths = (proofs.data || []).map(function(p) { return p.proof_file_path; }).filter(Boolean);
    if (paths.length) await supabase.storage.from(PROOF_BUCKET).remove(paths);
    // 3. proofs는 cascade로 자동 삭제됨. 미션 삭제.
    await supabase.from("promotion_missions").delete().eq("id", m.id);
    await load();
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: isMobile ? "center" : "flex-end", justifyContent: isMobile ? "center" : "space-between", gap: 16, marginBottom: 18, textAlign: isMobile ? "center" : "left" }}>
        <div style={{ width: "100%", minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 24 : 28, fontWeight: 900, color: "#071C59", marginBottom: 6 }}>{mission ? "미션 수정" : "미션 등록"}</div>
          <div style={{ fontSize: isMobile ? 13 : 14, lineHeight: isMobile ? "19px" : "20px", color: "#42506A", fontWeight: 700, maxWidth: isMobile ? 320 : "none", margin: isMobile ? "0 auto" : 0, wordBreak: "keep-all" }}>새로운 홍보 미션을 등록하고 오늘의 대상자를 자동으로 배정합니다.</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.12fr 0.94fr", gap: isMobile ? 12 : 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={card({ padding: 0, overflow: "hidden" })}>
            <AdminCardSection title="1. 미션 정보" action={mission ? <button onClick={function() { deleteMission(mission); }} style={btnSmall({ background: "#FDECEC", color: "#E04848" })}>오늘 미션 삭제</button> : null}>
              <div style={{ fontSize: 13, color: "#42506A", fontWeight: 700, lineHeight: 1.6, marginBottom: 18 }}>미션명은 관리자 화면과 안내문에서 쓰는 운영용 이름입니다.</div>
              <AField label="미션명 *">
                <input style={aInput()} value={title} placeholder="예: 27기 신입부원 모집 홍보 2일차" onChange={function(e) { setTitle(e.target.value); }} />
              </AField>
              <AField label="미션 설명 (관리자 메모)">
                <textarea style={Object.assign({}, aInput(), { height: 82, resize: "vertical", lineHeight: 1.65 })} value={body} placeholder="예: 에브리타임 홍보게시판에 모집글 업로드" onChange={function(e) { setBody(e.target.value); }} />
              </AField>
            </AdminCardSection>

            <AdminCardSection title="2. 게시글 정보">
              <div style={{ fontSize: 13, color: "#42506A", fontWeight: 700, lineHeight: 1.6, marginBottom: 18 }}>회원 화면의 복붙 버튼에는 아래 게시글 제목과 내용이 표시됩니다.</div>
              <AField label="게시글 제목 *">
                <input style={aInput()} value={postTitle} placeholder="예: MAST 27기 신입부원 모집 🔥" onChange={function(e) { setPostTitle(e.target.value); }} />
              </AField>
              <AField label="게시글 내용">
                <textarea style={Object.assign({}, aInput(), { height: 230, resize: "vertical", lineHeight: 1.65 })} value={postBody} placeholder={"안녕하세요! 대학생 연합 창업 동아리 MAST입니다.\n\n모집 대상 / 활동 내용 / 신청 방법을 입력해 주세요."} onChange={function(e) { setPostBody(e.target.value); }} />
              </AField>
            </AdminCardSection>

            <AdminCardSection title="3. 첨부 이미지">
              <div style={{ fontSize: 12, color: "#42506A", fontWeight: 700, marginBottom: 10 }}>최대 5장까지 첨부할 수 있으며, 권장 크기는 1080x1350px 입니다.</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <div onClick={function() { imgRef.current && imgRef.current.click(); }}
                  style={{ minHeight: 118, border: "1px dashed #BCD0F0", borderRadius: 12, padding: 20, textAlign: "center", cursor: "pointer", background: "#FBFDFF", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ marginBottom: 8, display: "flex", justifyContent: "center", color: BLUE }}><IconAttach color={BLUE} /></div>
                  <div style={{ fontSize: 13, color: BLUE, fontWeight: 900 }}>이미지 업로드</div>
                  <div style={{ fontSize: 11, color: SUB, marginTop: 6 }}>JPG, PNG (최대 10MB)</div>
                </div>
                <div style={{ minHeight: 118, border: "1px solid #E5EAF2", borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 12, background: "#fff" }}>
                  {imgPreview ? <img src={imgPreview} alt="미리보기" style={{ width: 112, height: 92, objectFit: "cover", borderRadius: 10, border: "1px solid #E5EAF2", flexShrink: 0 }} /> : <div style={{ width: 112, height: 92, borderRadius: 10, background: "#F1F4F9", flexShrink: 0 }} />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 900, color: INK, marginBottom: 4 }}>{imgFile ? imgFile.name : imgPreview ? "첨부 이미지" : "이미지 없음"}</div>
                    <div style={{ fontSize: 11, color: SUB }}>{imgFile ? Math.max(1, Math.round(imgFile.size / 1024)) + "KB" : imgPreview ? "현재 등록됨" : "선택된 파일이 없습니다."}</div>
                    {imgPreview && <button onClick={removeImage} style={btnSmall({ background: "transparent", color: "#E04848", padding: "7px 0", marginTop: 8 })}>삭제</button>}
                  </div>
                </div>
              </div>
              <input ref={imgRef} type="file" accept="image/*" onChange={pickImage} style={{ display: "none" }} />
            </AdminCardSection>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={card({ padding: 0, overflow: "hidden" })}>
            <AdminCardSection title="자동 배정 미리보기" subtitle="학교별 자동 선택으로 계산한 대상자가 미션 저장 시 배정됩니다.">
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
                <PreviewStat label="전체 학교" value={new Set(members.map(function(m) { return m.school; })).size} unit="개" />
                <PreviewStat label="오늘 대상자" value={selected.size} unit="명" />
                <PreviewSplitStat label="소규모 학교" rows={[{ label: "1인 학교", value: oneMemberSchools.length }, { label: "2인 학교", value: twoMemberSchools.length }]} />
                <PreviewStat label="예상 게시글" value={selected.size} unit="건" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 10 }}>
                <div style={{ border: "1px solid #E5EAF2", background: "#F8FAFF", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 13, color: "#071C59", fontWeight: 900, marginBottom: 6 }}>학교별 자동 배정 규칙</div>
                  <div style={{ fontSize: 12, color: "#42506A", fontWeight: 700, lineHeight: 1.65 }}>
                    학교별 마지막 배정일로부터 기본 3일, 연세대학교 미래캠퍼스는 14일이 지난 학교만 자동 선정합니다. 선정되는 학교 안에서는 부원 수와 관계없이 가나다순 다음 순번을 배정합니다.
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <button style={btnSmall({ background: "#E8F0FE", color: BLUE, border: "1px solid #C8D8F6", borderRadius: 10 })} disabled={!rotationReady} onClick={applyRotationPick}>학교별 자동 선택</button>
                <button style={btnSmall({ background: missingCandidateCount ? "#FFF7E8" : "#F8FAFF", color: missingCandidateCount ? "#C65A00" : SUB, border: "1px solid " + (missingCandidateCount ? "#F6D8A8" : "#DDE4F0"), borderRadius: 10 })} onClick={function() { setMissingOpen(true); }}>누락 확인{missingCandidateCount ? " " + missingCandidateCount : ""}</button>
                <button style={btnSmall({ background: "#F8FAFF", border: "1px solid #DDE4F0", borderRadius: 10 })} onClick={function() { setSelected(new Set(members.map(function(m) { return m.id; }))); }}>전체 선택</button>
                <button style={btnSmall({ background: "#F8FAFF", border: "1px solid #DDE4F0", borderRadius: 10 })} onClick={function() { setSelected(new Set()); }}>전체 해제</button>
              </div>
              {rotationHint && <div style={{ fontSize: 12, color: BLUE, background: "#EEF5FF", padding: "8px 10px", borderRadius: 10, marginBottom: 12, fontWeight: 800 }}>{rotationHint}</div>}

              <AField label={"오늘 배정 예정 대상자 (" + selected.size + "명)"}>
                <input style={aInput()} value={query} placeholder="이름/학교/기수 검색" onChange={function(e) { setQuery(e.target.value); }} />
              </AField>
              <div style={{ maxHeight: 238, overflow: "auto", border: "1px solid #E5EAF2", borderRadius: 12, marginBottom: 14, background: "#fff" }}>
                {filtered.map(function(m) {
                  var k = m.id, on = selected.has(k);
                  var consecutive = on && prevAssignmentIds.has(k);
                  var schoolMemberCount = members.filter(function(x) { return schoolKey(x.school) === schoolKey(m.school); }).length;
                  return (
                    <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderTop: "1px solid #F1F4F9", cursor: "pointer", background: on ? "#EEF5FF" : "#fff" }}>
                      <input type="checkbox" checked={on} onChange={function() { setSelected(function(prev) { var n = new Set(prev); if(n.has(k)) n.delete(k); else n.add(k); return n; }); }} />
                      <span style={{ fontWeight: 900, fontSize: 13, color: INK }}>{m.name}</span>
                      <span style={{ fontSize: 12, color: SUB, flex: 1 }}>{m.gi + " · " + m.school}</span>
                      {consecutive && <span style={{ fontSize: 11, fontWeight: 900, color: "#E05A00", background: "#FFF4E5", padding: "2px 8px", borderRadius: 999 }}>연속</span>}
                      {schoolMemberCount <= 2 && <span style={{ fontSize: 11, fontWeight: 900, color: "#00A879", background: "#E8F8F2", padding: "2px 8px", borderRadius: 999 }}>{schoolMemberCount + "인"}</span>}
                    </label>
                  );
                })}
              </div>
              <div style={{ border: "1px solid #E5EAF2", borderRadius: 12, overflowY: "auto", overflowX: "hidden", maxHeight: isMobile ? 360 : 420, background: "#fff" }}>
                {schoolPreviewRows.length === 0 ? <div style={{ padding: 18, color: SUB, fontSize: 13, textAlign: "center" }}>선택된 대상자가 없습니다.</div> : schoolPreviewRows.map(function(row, i) {
                  return <AdminPreviewSchoolRow key={row.school} row={row} index={i} />;
                })}
              </div>
            </AdminCardSection>
          </div>

          <div style={card({ padding: 0, overflow: "hidden" })}>
            <AdminCardSection title="마감 설정">
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <AField label="마감일 *">
                  <input style={aInput()} type="date" value={deadlineDate} onChange={function(e) { setDeadlineDate(e.target.value); }} />
                </AField>
                <AField label="마감 시간 *">
                  <input style={aInput()} type="time" value={deadline} onChange={function(e) { setDeadline(e.target.value); }} />
                </AField>
              </div>
              <div style={{ fontSize: 12, color: SUB, fontWeight: 700 }}>관리자가 마감일과 시간을 자유롭게 정할 수 있습니다. 마감 후 미제출 확정 뒤 24시간 이내 제출은 지각으로 처리됩니다.</div>
            </AdminCardSection>
          </div>

          {(msg || draftMsg) && <div style={{ fontSize: 13, color: msg.indexOf("오류") !== -1 ? "#E04848" : "#10A26A", fontWeight: 800, padding: "0 4px" }}>{msg || draftMsg}</div>}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1.1fr", gap: 10 }}>
            <button style={btnGhost({ borderRadius: 10, background: "#fff" })} onClick={function() { setPreviewOpen(true); }}>미리보기</button>
            <button style={btnGhost({ borderRadius: 10 })} onClick={saveDraft}>임시저장</button>
            <button style={btnGhost({ borderRadius: 10 })} onClick={loadDraft}>불러오기</button>
            <button style={btnPrimary({ opacity: busy ? 0.7 : 1, padding: "13px 0", fontSize: 14, borderRadius: 10 })} disabled={busy} onClick={save}>
              {busy ? "저장 중..." : mission ? "미션 수정" : "미션 등록"}
            </button>
          </div>
        </div>
      </div>

      {previewOpen && (
        <Modal onClose={function() { setPreviewOpen(false); }} maxWidth={720}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#071C59", marginBottom: 14 }}>미션 미리보기</div>
          <div style={homeHeroCard({ height: 210, marginBottom: 14 })}>
            <img src={assets.hero.megaphone} alt="" style={{ position: "absolute", left: 2, top: 18, width: 300, height: "auto", objectFit: "contain" }} />
            <div style={{ position: "absolute", right: 28, top: 34, width: 280 }}>
              <div style={{ display: "inline-flex", background: "#E9FFF8", color: "#00A879", borderRadius: 16, padding: "6px 14px", fontSize: 13, fontWeight: 900, marginBottom: 18 }}>오늘 홍보 미션</div>
              <div style={{ fontSize: fitFontSize(postTitle || "게시글 제목", 30, 20, 10, 4), lineHeight: "36px", fontWeight: 900, color: "#071C59", marginBottom: 12, wordBreak: "keep-all", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{postTitle || "게시글 제목"}</div>
              <div style={{ fontSize: fitFontSize(title || "미션명", 13, 10, 18, 7), color: "#66728A", fontWeight: 800, marginBottom: 8, wordBreak: "keep-all" }}>미션: {title || "미션명"}</div>
              <div style={{ fontSize: 14, color: "#66728A", fontWeight: 800 }}>마감 {deadlineDate + " " + deadline}</div>
            </div>
          </div>
          <div style={card({ boxShadow: "none", border: "1px solid #E5EAF2", padding: 16, marginBottom: 14 })}>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#071C59", marginBottom: 8 }}>게시글 내용</div>
            <div style={{ fontSize: 13, color: INK, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{postBody || "입력된 게시글 내용이 없습니다."}</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {selectedMembers.slice(0, 12).map(function(m) {
              return <NamePill key={m.id} name={m.name} submitted={false} />;
            })}
            {selectedMembers.length > 12 && <NamePill name={"+" + (selectedMembers.length - 12)} submitted={false} />}
          </div>
        </Modal>
      )}

      {missingOpen && (
        <Modal onClose={function() { setMissingOpen(false); }} maxWidth={720}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#071C59", marginBottom: 8 }}>순서 누락 확인</div>
          <div style={{ fontSize: 13, color: SUB, fontWeight: 800, lineHeight: 1.6, marginBottom: 14 }}>
            가나다 순서상 선정됐어야 했는데 다음 사람으로 넘어간 부원입니다. 수동 선정이 필요하면 이름 옆 버튼으로 오늘 대상자에 추가할 수 있습니다.
          </div>
          {missingRotationRows.length === 0 ? (
            <div style={{ padding: 20, borderRadius: 16, background: "#F8FAFF", color: SUB, fontSize: 13, fontWeight: 800, textAlign: "center" }}>현재 순서상 누락 후보가 없습니다.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 520, overflow: "auto" }}>
              {missingRotationRows.map(function(row) {
                return (
                  <div key={row.school} style={{ border: "1px solid #E5EAF2", borderRadius: 16, padding: 14, background: "#fff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 10 }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: INK }}>{row.school}</div>
                      <div style={{ fontSize: 11, color: "#C65A00", fontWeight: 900 }}>가나다 순서 누락 {row.candidates.length}명</div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      {row.candidates.map(function(m) {
                        var on = selected.has(m.id);
                        return (
                          <button key={m.id} onClick={function() { toggleSelectedMember(m.id); }} style={{ border: "1px solid " + (on ? "#BDEDDC" : "#F6D8A8"), borderRadius: 999, background: on ? "#E8F8F2" : "#FFF7E8", color: on ? "#00A879" : "#C65A00", padding: "7px 10px", fontSize: 12, fontWeight: 900, fontFamily: FONT, cursor: "pointer" }}>
                            {m.name} · {on ? "선택됨" : "대상 추가"}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                      {row.candidates.map(function(m) {
                        return (
                          <div key={m.id + "_reason"} style={{ fontSize: 11, color: SUB, fontWeight: 800 }}>
                            {m.name}: {m.skip_reason}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {row.members.map(function(m) {
                        var isCandidate = row.candidates.some(function(c) { return c.id === m.id; });
                        return (
                          <span key={m.id} style={{ borderRadius: 999, background: isCandidate ? "#FFF7E8" : "#F3F6FB", color: isCandidate ? "#C65A00" : "#66728A", padding: "5px 8px", fontSize: 11, fontWeight: 800 }}>
                            {m.order_no}. {m.name}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function AdminMissionHistory() {
  var winW = useWindowWidth();
  var isMobile = winW < 768;
  var _missions = useState([]), missions = _missions[0], setMissions = _missions[1];
  var _schoolTrailRows = useState([]), schoolTrailRows = _schoolTrailRows[0], setSchoolTrailRows = _schoolTrailRows[1];
  var _selectedSchool = useState(""), selectedSchool = _selectedSchool[0], setSelectedSchool = _selectedSchool[1];
  var _loading = useState(true), loading = _loading[0], setLoading = _loading[1];
  var _query = useState(""), query = _query[0], setQuery = _query[1];
  var _editMission = useState(null), editMission = _editMission[0], setEditMission = _editMission[1];
  var _editTitle = useState(""), editTitle = _editTitle[0], setEditTitle = _editTitle[1];
  var _editBody = useState(""), editBody = _editBody[0], setEditBody = _editBody[1];
  var _editPostTitle = useState(""), editPostTitle = _editPostTitle[0], setEditPostTitle = _editPostTitle[1];
  var _editPostBody = useState(""), editPostBody = _editPostBody[0], setEditPostBody = _editPostBody[1];
  var _editMissionDate = useState(todayKST()), editMissionDate = _editMissionDate[0], setEditMissionDate = _editMissionDate[1];
  var _editDueDate = useState(todayKST()), editDueDate = _editDueDate[0], setEditDueDate = _editDueDate[1];
  var _editDueTime = useState("02:00"), editDueTime = _editDueTime[0], setEditDueTime = _editDueTime[1];
  var _editMsg = useState(""), editMsg = _editMsg[0], setEditMsg = _editMsg[1];
  var _editBusy = useState(false), editBusy = _editBusy[0], setEditBusy = _editBusy[1];

  var loadHistory = useCallback(async function() {
    setLoading(true);
    var r = await supabase.from("promotion_missions").select("*").order("mission_date", { ascending: false }).limit(60);
    setMissions(r.data || []);
    var t = await supabase
      .from("promotion_assignment_status_view")
      .select("member_id,member_name,gi,school,mission_date,status,submitted_at")
      .order("mission_date", { ascending: false })
      .limit(500);
    setSchoolTrailRows(t.data || []);
    setLoading(false);
  }, []);

  useEffect(function() { loadHistory(); }, [loadHistory]);

  function openHistoryEdit(m) {
    setEditMission(m);
    setEditTitle(m.title || "");
    setEditBody(m.body || "");
    setEditPostTitle(postTitleOf(m));
    setEditPostBody(postBodyOf(m));
    setEditMissionDate(m.mission_date || todayKST());
    setEditDueDate(inputDateFromIsoKST(m.due_at));
    setEditDueTime(inputTimeFromIsoKST(m.due_at));
    setEditMsg("");
  }

  async function saveHistoryEdit() {
    if (!editMission) return;
    if (!editTitle.trim() || !editPostTitle.trim()) {
      setEditMsg("미션명과 게시글 제목을 입력해 주세요.");
      return;
    }
    setEditBusy(true);
    setEditMsg("");
    try {
      var dueAt = exactIsoKST(editDueDate, editDueTime);
      var lateUntilAt = new Date(new Date(dueAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
      var row = {
        mission_date: editMissionDate,
        title: editTitle.trim(),
        body: editBody.trim() || null,
        post_title: editPostTitle.trim(),
        post_body: editPostBody.trim() || null,
        due_at: dueAt,
        late_until_at: lateUntilAt
      };
      var res = await supabase.from("promotion_missions").update(row).eq("id", editMission.id);
      if (res.error) throw res.error;
      var assignRes = await supabase.from("promotion_mission_assignments").update({ due_at: dueAt, late_until_at: lateUntilAt }).eq("mission_id", editMission.id);
      if (assignRes.error) throw assignRes.error;
      setEditMission(null);
      await loadHistory();
    } catch(e) {
      setEditMsg("수정 중 오류가 발생했습니다: " + e.message);
      console.error(e);
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteHistoryMission(m) {
    if (!confirm("과거 미션 \"" + m.title + "\" 을(를) 삭제하시겠습니까?\n관련 배정과 인증 기록도 함께 삭제됩니다.")) return;
    setEditMsg("");
    if (m.mission_image_path) await supabase.storage.from(MISSION_BUCKET).remove([m.mission_image_path]);
    var proofs = await supabase.from("promotion_proofs").select("id, proof_file_path").eq("mission_id", m.id);
    var paths = (proofs.data || []).map(function(p) { return p.proof_file_path; }).filter(Boolean);
    if (paths.length) await supabase.storage.from(PROOF_BUCKET).remove(paths);
    await supabase.from("promotion_proofs").delete().eq("mission_id", m.id);
    await supabase.from("promotion_mission_assignments").delete().eq("mission_id", m.id);
    var del = await supabase.from("promotion_missions").delete().eq("id", m.id);
    if (del.error) {
      alert("삭제 중 오류가 발생했습니다: " + del.error.message);
      console.error(del.error);
      return;
    }
    await loadHistory();
  }

  var q = normalize(query);
  var filteredMissions = q ? missions.filter(function(m) {
    return normalize([
      m.mission_date,
      m.title,
      m.body,
      postTitleOf(m),
      postBodyOf(m)
    ].join(" ")).indexOf(q) !== -1;
  }) : missions;
  var schoolMap = {};
  schoolTrailRows.forEach(function(row) {
    var key = schoolKey(row.school);
    if (!key) return;
    if (!schoolMap[key]) schoolMap[key] = { school: row.school, rows: [], submitted: 0 };
    schoolMap[key].rows.push(row);
    if ([ST.SUBMITTED, ST.APPROVED, ST.LATE].indexOf(row.status) !== -1) schoolMap[key].submitted += 1;
  });
  var schoolTrail = Object.keys(schoolMap).map(function(key) { return schoolMap[key]; }).sort(function(a, b) {
    return String(a.school || "").localeCompare(String(b.school || ""), "ko");
  });
  var activeSchool = selectedSchool || (schoolTrail[0] ? schoolTrail[0].school : "");
  var activeSchoolRows = schoolTrailRows.filter(function(row) { return schoolKey(row.school) === schoolKey(activeSchool); });

  return (
    <div>
      <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, color: "#071C59", marginBottom: 6 }}>학교별 홍보 기록</div>
      <div style={{ fontSize: 13, color: SUB, fontWeight: 800, marginBottom: 16 }}>학교를 선택하면 지난 미션 날짜와 담당자를 확인합니다.</div>
      {loading ? <div style={{ color: SUB }}>불러오는 중...</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "240px 1fr", gap: 12, marginBottom: 16 }}>
            <div style={card({ padding: 10, maxHeight: isMobile ? "none" : 390, overflow: "auto" })}>
              {schoolTrail.length === 0 ? <Empty /> : schoolTrail.map(function(s) {
                var active = schoolKey(s.school) === schoolKey(activeSchool);
                return (
                  <button key={s.school} onClick={function() { setSelectedSchool(s.school); }} style={{ width: "100%", border: "1px solid " + (active ? "#9edcf7" : "#E5EBF3"), background: active ? "linear-gradient(145deg,#e7f6fd,#fff8da)" : "#fff", borderRadius: 14, padding: "11px 12px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: FONT, cursor: "pointer", color: active ? BLUE : INK, fontWeight: 900 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.school}</span>
                    <small style={{ color: active ? BLUE : SUB, fontWeight: 900 }}>{s.rows.length}회</small>
                  </button>
                );
              })}
            </div>
            <div style={card({ padding: 0, overflow: "hidden" })}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #EEF2F8", display: "flex", justifyContent: "space-between", gap: 10 }}>
                <b style={{ color: "#071C59", fontSize: 15 }}>{activeSchool || "학교 선택"}</b>
                <span style={{ color: BLUE, fontSize: 12, fontWeight: 900 }}>{promotionIntervalDays(activeSchool)}일 1회 기준</span>
              </div>
              {activeSchoolRows.length === 0 ? <Empty /> : activeSchoolRows.slice(0, 20).map(function(row, i) {
                var done = [ST.SUBMITTED, ST.APPROVED, ST.LATE].indexOf(row.status) !== -1;
                return (
                  <div key={row.member_id + row.mission_date + i} style={{ display: "grid", gridTemplateColumns: "86px 1fr auto", gap: 10, alignItems: "center", padding: "12px 16px", borderTop: i ? "1px solid #F1F4F9" : "none" }}>
                    <span style={{ color: SUB, fontSize: 12, fontWeight: 900 }}>{fmtShortDate(row.mission_date)}</span>
                    <div style={{ minWidth: 0 }}>
                      <b style={{ display: "block", color: INK, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.member_name || "담당자 미확인"}</b>
                      <small style={{ color: SUB, fontWeight: 800 }}>{row.gi || ""}</small>
                    </div>
                    <span style={{ color: stColor(row.status), fontSize: 11, fontWeight: 900 }}>{row.status === ST.EXEMPTED ? "면제" : done ? "제출" : "미제출"}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: "#071C59", margin: "18px 0 8px" }}>미션 관리</div>
          <input
            value={query}
            onChange={function(e) { setQuery(e.target.value); }}
            placeholder="미션명, 게시글, 날짜 검색"
            style={Object.assign({}, aInput(), { height: 46, marginBottom: 12, borderRadius: 14, fontWeight: 800 })}
          />
          <div style={card({ padding: 0, overflow: "hidden" })}>
          {filteredMissions.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: SUB, fontSize: 13 }}>{query ? "검색 결과가 없습니다." : "과거 미션이 없습니다."}</div> : filteredMissions.map(function(m, i) {
            return (
              <div key={m.id} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "150px 1fr 170px 132px", gap: 10, alignItems: "center", padding: isMobile ? "12px 14px" : "14px 20px", borderTop: i ? "1px solid #F1F4F9" : "none" }}>
                <div style={{ fontSize: 12, color: SUB, fontWeight: 900 }}>{m.mission_date}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: SUB, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{postTitleOf(m)}</div>
                </div>
                <div style={{ fontSize: 12, color: "#071C59", fontWeight: 900, textAlign: isMobile ? "left" : "right" }}>마감 {fmtShortDate(m.due_at)} {fmtTime(m.due_at)}</div>
                <div style={{ display: "flex", gap: 6, justifyContent: isMobile ? "flex-start" : "flex-end" }}>
                  <button onClick={function() { openHistoryEdit(m); }} style={btnSmall({ background: "#EEF5FF", color: BLUE, borderRadius: 10, padding: "7px 10px", fontSize: 11 })}>수정</button>
                  <button onClick={function() { deleteHistoryMission(m); }} style={btnSmall({ background: "#FDECEC", color: "#E04848", borderRadius: 10, padding: "7px 10px", fontSize: 11 })}>삭제</button>
                </div>
              </div>
            );
          })}
          </div>
        </>
      )}
      {editMission && (
        <Modal onClose={function() { if (!editBusy) setEditMission(null); }} maxWidth={760}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#071C59", marginBottom: 6 }}>과거 미션 수정</div>
          <div style={{ fontSize: 13, color: SUB, fontWeight: 800, marginBottom: 18 }}>배정 인원은 유지하고 미션 정보와 마감만 수정합니다.</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <AField label="미션 날짜">
              <input type="date" style={aInput()} value={editMissionDate} onChange={function(e) { setEditMissionDate(e.target.value); }} />
            </AField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <AField label="마감일">
                <input type="date" style={aInput()} value={editDueDate} onChange={function(e) { setEditDueDate(e.target.value); }} />
              </AField>
              <AField label="마감 시간">
                <input type="time" style={aInput()} value={editDueTime} onChange={function(e) { setEditDueTime(e.target.value); }} />
              </AField>
            </div>
          </div>
          <AField label="미션명 *">
            <input style={aInput()} value={editTitle} onChange={function(e) { setEditTitle(e.target.value); }} />
          </AField>
          <AField label="미션 설명">
            <textarea style={Object.assign({}, aInput(), { minHeight: 78, resize: "vertical", lineHeight: 1.6 })} value={editBody} onChange={function(e) { setEditBody(e.target.value); }} />
          </AField>
          <AField label="게시글 제목 *">
            <input style={aInput()} value={editPostTitle} onChange={function(e) { setEditPostTitle(e.target.value); }} />
          </AField>
          <AField label="게시글 내용">
            <textarea style={Object.assign({}, aInput(), { minHeight: 180, resize: "vertical", lineHeight: 1.65 })} value={editPostBody} onChange={function(e) { setEditPostBody(e.target.value); }} />
          </AField>
          {editMsg && <div style={{ fontSize: 13, color: editMsg.indexOf("오류") !== -1 ? "#E04848" : BLUE, fontWeight: 800, marginBottom: 10 }}>{editMsg}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnGhost()} disabled={editBusy} onClick={function() { setEditMission(null); }}>취소</button>
            <button style={btnPrimary({ opacity: editBusy ? 0.65 : 1 })} disabled={editBusy} onClick={saveHistoryEdit}>{editBusy ? "저장 중..." : "저장"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AdminCardSection(props) {
  return (
    <div style={{ padding: 22, borderTop: props.noBorder ? "none" : "1px solid #F1F4F9" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: props.subtitle ? 6 : 16 }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: "#071C59" }}>{props.title}</div>
        {props.action}
      </div>
      {props.subtitle && <div style={{ fontSize: 13, color: "#42506A", fontWeight: 700, lineHeight: 1.55, marginBottom: 16 }}>{props.subtitle}</div>}
      {props.children}
    </div>
  );
}

function PreviewStat(props) {
  return (
    <div style={{ border: "1px solid #E5EAF2", borderRadius: 12, padding: "13px 14px", minHeight: 78, boxSizing: "border-box", background: "#fff", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start" }}>
      <div style={{ fontSize: 12, lineHeight: "16px", color: "#42506A", fontWeight: 900, marginBottom: 6, whiteSpace: "nowrap" }}>{props.label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, color: "#071C59", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 28, lineHeight: "32px", fontWeight: 900 }}>{props.value}</span>
        <span style={{ fontSize: 15, lineHeight: "18px", fontWeight: 900 }}>{props.unit}</span>
      </div>
    </div>
  );
}
function PreviewSplitStat(props) {
  return (
    <div style={{ border: "1px solid #E5EAF2", borderRadius: 12, padding: "10px 12px", minHeight: 78, boxSizing: "border-box", background: "#fff", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
      <div style={{ fontSize: 12, lineHeight: "16px", color: "#42506A", fontWeight: 900, whiteSpace: "nowrap" }}>{props.label}</div>
      {props.rows.map(function(row) {
        return (
          <div key={row.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, color: "#071C59", whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: SUB }}>{row.label}</span>
            <span style={{ fontSize: 15, fontWeight: 900 }}>{row.value}<span style={{ fontSize: 11, marginLeft: 2 }}>개</span></span>
          </div>
        );
      })}
    </div>
  );
}

function AdminPreviewSchoolRow(props) {
  var row = props.row;
  var colors = ["#0869F4", "#7C4DFF", "#F97316", "#EF4565", "#00A879"];
  var color = colors[props.index % colors.length];
  var _expanded = useState(false), expanded = _expanded[0], setExpanded = _expanded[1];
  var smallSchool = row.count <= 2;
  var nextLabel = row.count === 1 ? "없음" : row.next ? row.next.name : "없음";
  var todayIds = {};
  row.today.forEach(function(m) { todayIds[m.id] = true; });
  return (
    <div style={{ borderTop: props.index ? "1px solid #F1F4F9" : "none" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.9fr 0.9fr 24px", alignItems: "center", gap: 8, padding: "13px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: color + "18", color: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IconSchoolSolid color={color} /></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, lineHeight: "17px", fontWeight: 900, color: INK, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "keep-all" }}>{row.school}</div>
            <div style={{ display: "inline-flex", alignItems: "center", marginTop: 3, padding: smallSchool ? "2px 7px" : 0, borderRadius: 999, background: smallSchool ? "#E8F8F2" : "transparent", color: smallSchool ? "#00A879" : SUB, fontSize: 11, fontWeight: smallSchool ? 900 : 700 }}>{row.count + "명"}</div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: SUB, fontWeight: 800, marginBottom: 3 }}>오늘 대상자</div>
          <div style={{ fontSize: 13, color: INK, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.today.map(function(m) { return m.name; }).join(", ")}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: SUB, fontWeight: 800, marginBottom: 3 }}>다음 대상자</div>
          <div style={{ fontSize: 13, color: INK, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nextLabel}</div>
        </div>
        <button aria-label="학교 순서 보기" onClick={function() { setExpanded(!expanded); }} style={{ border: "none", background: "#F3F7FF", color: BLUE, borderRadius: 8, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: 16, fontWeight: 900, cursor: "pointer", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}>›</button>
      </div>
      {expanded && <div style={{ padding: "0 12px 12px 56px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 10, borderRadius: 12, background: "#F8FAFF", border: "1px solid #E7EDF7" }}>
          {row.members.map(function(m, i) {
            var active = !!todayIds[m.id];
            var isNext = row.next && row.next.id === m.id;
            return (
              <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 8px", borderRadius: 999, background: active ? "#E8F8F2" : isNext ? "#EEF5FF" : "#fff", color: active ? "#00A879" : isNext ? BLUE : "#42506A", border: "1px solid " + (active ? "#BDEDDC" : isNext ? "#CFE0FF" : "#E3E9F2"), fontSize: 11, fontWeight: 900 }}>
                <span style={{ color: active || isNext ? "inherit" : SUB }}>{i + 1}</span>
                {m.name}
                {active && <span>오늘</span>}
                {isNext && <span>다음</span>}
              </span>
            );
          })}
        </div>
      </div>}
    </div>
  );
}

/* ─── 관리자 부원 관리 (추가·수정·삭제, 상세 모달) ─── */
function AdminMembers() {
  var winW = useWindowWidth();
  var isMobile = winW < 768;
  var _members = useState([]), members = _members[0], setMembers = _members[1];
  var _proofStats = useState({}), proofStats = _proofStats[0], setProofStats = _proofStats[1];
  var _loading = useState(true), loading = _loading[0], setLoading = _loading[1];
  var _query = useState(""), query = _query[0], setQuery = _query[1];
  var _sortMode = useState("missing"), sortMode = _sortMode[0], setSortMode = _sortMode[1];
  var _detail = useState(null), detail = _detail[0], setDetail = _detail[1];
  var _editing = useState(null), editing = _editing[0], setEditing = _editing[1];
  var _showAdd = useState(false), showAdd = _showAdd[0], setShowAdd = _showAdd[1];

  var load = useCallback(async function() {
    setLoading(true);
    var r1 = await supabase.from("members").select(LEGACY_MEMBER_FIELDS).eq("status", "active").order("name");
    setMembers(r1.data || []);
    var r2 = await supabase.from("promotion_member_progress_view").select("*");
    var stats = {};
    (r2.data || []).forEach(function(p) {
      stats[p.member_id] = { total: p.target_count || 0, approved: (p.approved_count || 0) + (p.late_count || 0), rejected: p.incomplete_count || 0, pending: p.submitted_count || 0, rate: p.completion_rate || 0 };
    });
    var r3 = await supabase.from("promotion_assignment_status_view").select("member_id,status,completion_score,counts_in_rate");
    var byMember = {};
    (r3.data || []).forEach(function(row) {
      if (!byMember[row.member_id]) byMember[row.member_id] = { total: 0, approved: 0, rejected: 0, pending: 0, rated: 0, earned: 0 };
      var s = byMember[row.member_id];
      s.total += 1;
      if (row.status === ST.APPROVED || row.status === ST.LATE) s.approved += 1;
      if (countsAsMissing(row.status)) s.rejected += 1;
      if (row.status === ST.SUBMITTED) s.pending += 1;
      if (row.counts_in_rate) {
        s.rated += 1;
        s.earned += row.completion_score || 0;
      }
    });
    Object.keys(byMember).forEach(function(memberId) {
      var s = byMember[memberId];
      stats[memberId] = {
        total: s.total,
        approved: s.approved,
        rejected: s.rejected,
        pending: s.pending,
        rate: s.rated ? Math.round(s.earned / s.rated * 100) : 0
      };
    });
    setProofStats(stats);
    setLoading(false);
  }, []);

  useEffect(function() { load(); }, [load]);

  async function deleteMember(m) {
    if (!confirm("부원 \"" + m.name + "\" 을(를) 명단에서 삭제하시겠습니까?\n인증 기록도 함께 삭제됩니다.")) return;
    // 인증 사진들 삭제
    var proofs = await supabase.from("promotion_proofs").select("proof_file_path").eq("member_id", m.id);
    var paths = (proofs.data || []).map(function(p) { return p.proof_file_path; }).filter(Boolean);
    if (paths.length) await supabase.storage.from(PROOF_BUCKET).remove(paths);
    await supabase.from("members").delete().eq("id", m.id);
    await load();
  }

  function statOfMember(m) {
    return proofStats[m.id] || { total: 0, approved: 0, rejected: 0, pending: 0, rate: 0 };
  }
  var filtered = query.trim() ? members.filter(function(m) { return m.name.includes(query) || m.school.includes(query) || m.gi.includes(query); }) : members;
  filtered = filtered.slice().sort(function(a, b) {
    var sa = statOfMember(a);
    var sb = statOfMember(b);
    if (sortMode === "rate") return (sb.rate || 0) - (sa.rate || 0) || String(a.name || "").localeCompare(String(b.name || ""), "ko");
    if (sortMode === "name") return String(a.name || "").localeCompare(String(b.name || ""), "ko");
    return (sb.rejected || 0) - (sa.rejected || 0) || String(a.name || "").localeCompare(String(b.name || ""), "ko");
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", marginBottom: 16, flexDirection: isMobile ? "column" : "row", gap: isMobile ? 10 : 0 }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: INK }}>부원 관리</div>
        <button onClick={function() { setShowAdd(true); }} style={btnPrimary({ width: isMobile ? "100%" : "auto", padding: "10px 18px", fontSize: 14 })}>+ 부원 추가</button>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 220px", gap: 8, maxWidth: isMobile ? "none" : 560 }}>
          <input style={aInput()} value={query} placeholder="이름/학교/기수 검색" onChange={function(e) { setQuery(e.target.value); }} />
          <select style={aInput()} value={sortMode} onChange={function(e) { setSortMode(e.target.value); }}>
            <option value="missing">미인증 높은 순</option>
            <option value="rate">인증률 높은 순</option>
            <option value="name">가나다순</option>
          </select>
        </div>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 10 }}>부원을 클릭하면 상세 인증 이력을 볼 수 있습니다.</div>
      {loading ? <div style={{ color: SUB }}>불러오는 중...</div> : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(function(m) {
            var st = statOfMember(m);
            var rate = Math.round(st.rate || 0);
            return (
              <div key={m.id} style={card({ padding: 16 })}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div onClick={function() { setDetail(m); }} style={{ fontWeight: 900, fontSize: 15, color: BLUE, cursor: "pointer", whiteSpace: "nowrap" }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: SUB, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.gi + " · " + m.school}</div>
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div style={{ fontSize: 11, color: "#E04848", fontWeight: 900 }}>미인증</div>
                    <div style={{ fontSize: 20, lineHeight: "24px", fontWeight: 900, color: st.rejected ? "#E04848" : "#10A26A" }}>{st.rejected}회</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12, color: SUB, fontWeight: 800 }}>
                  <span>완료 {st.approved}회</span>
                  <span>·</span>
                  <span>인증률 {rate}%</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button onClick={function() { setDetail(m); }} style={btnSmall({ background: "#F0F4FB", color: BLUE, padding: "8px 10px" })}>홍보 수정</button>
                  <button onClick={function() { deleteMember(m); }} style={btnSmall({ background: "#FDECEC", color: "#E04848", padding: "8px 10px" })}>삭제</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={card({ padding: 0, overflow: "hidden" })}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr 0.8fr 0.8fr 1.2fr 1fr", padding: "13px 20px", borderBottom: "1px solid #F1F4F9", background: "#F8FAFF" }}>
            {["이름", "학교", "기수", "미인증", "완료/인증률", "관리"].map(function(h) {
              return <div key={h} style={{ fontSize: 12, fontWeight: 800, color: SUB }}>{h}</div>;
            })}
          </div>
          {filtered.map(function(m, i) {
            var st = statOfMember(m);
            var rate = Math.round(st.rate || 0);
            return (
              <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr 0.8fr 0.8fr 1.2fr 1fr", padding: "13px 20px", borderTop: i ? "1px solid #F1F4F9" : "none", alignItems: "center" }}>
                <div onClick={function() { setDetail(m); }} style={{ fontWeight: 700, fontSize: 14, color: BLUE, cursor: "pointer" }}>{m.name} ›</div>
                <div style={{ fontSize: 13, color: "#4A5568" }}>{m.school}</div>
                <div style={{ fontSize: 13, color: SUB }}>{m.gi}</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: st.rejected ? "#E04848" : "#10A26A" }}>{st.rejected}회</div>
                <div>
                  <div style={{ fontSize: 12, color: INK, fontWeight: 900 }}>{st.approved}회 완료</div>
                  <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>인증률 {rate}%</div>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <button onClick={function() { setDetail(m); }} style={btnSmall({ background: "#F0F4FB", color: BLUE, padding: "5px 10px" })}>홍보 수정</button>
                  <button onClick={function() { deleteMember(m); }} style={btnSmall({ background: "#FDECEC", color: "#E04848", padding: "5px 10px" })}>삭제</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detail && <MemberDetailModal member={detail} onClose={function() { setDetail(null); }} onChanged={load} />}
      {(showAdd || editing) && <MemberFormModal member={editing} onClose={function() { setShowAdd(false); setEditing(null); }} onSaved={function() { setShowAdd(false); setEditing(null); load(); }} />}
    </div>
  );
}

function MemberFormModal(props) {
  var isEdit = !!props.member;
  var _n = useState(isEdit ? props.member.name : ""), name = _n[0], setName = _n[1];
  var _g = useState(isEdit ? props.member.gi : ""), gi = _g[0], setGi = _g[1];
  var _sc = useState(isEdit ? props.member.school : ""), school = _sc[0], setSchool = _sc[1];
  var _busy = useState(false), busy = _busy[0], setBusy = _busy[1];
  var _err = useState(""), err = _err[0], setErr = _err[1];

  async function save() {
    if (!name.trim() || !gi.trim() || !school.trim()) { setErr("모든 항목을 입력해 주세요."); return; }
    setBusy(true); setErr("");
    try {
      if (isEdit) {
        var r = await supabase.from("members").update({ name: name.trim(), gi: gi.trim(), school: school.trim() })
          .eq("id", props.member.id);
        if (r.error) throw r.error;
      } else {
        var r2 = await supabase.from("members").insert({ name: name.trim(), gi: gi.trim(), school: school.trim() });
        if (r2.error) throw r2.error;
      }
      props.onSaved();
    } catch(e) { setErr("저장 실패: " + e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal onClose={props.onClose}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>{isEdit ? "부원 수정" : "부원 추가"}</div>
      <AField label="이름"><input style={aInput()} value={name} onChange={function(e) { setName(e.target.value); }} placeholder="홍길동" /></AField>
      <AField label="기수"><input style={aInput()} value={gi} onChange={function(e) { setGi(e.target.value); }} placeholder="26기" /></AField>
      <AField label="학교"><input style={aInput()} value={school} onChange={function(e) { setSchool(e.target.value); }} placeholder="홍익대학교" /></AField>
      {err && <div style={{ fontSize: 13, color: "#E04848", marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button style={btnGhost()} onClick={props.onClose}>취소</button>
        <button style={btnPrimary({ opacity: busy ? 0.6 : 1 })} disabled={busy} onClick={save}>{busy ? "저장 중..." : "저장"}</button>
      </div>
    </Modal>
  );
}

function MemberDetailModal(props) {
  var winW = useWindowWidth();
  var isMobile = winW < 640;
  var member = props.member;
  var _data = useState(null), data = _data[0], setData = _data[1];
  var _loading = useState(true), loading = _loading[0], setLoading = _loading[1];

  var load = useCallback(async function() {
    setLoading(true);
    var r = await supabase.from("promotion_assignment_status_view").select("*").eq("member_id", member.id).order("mission_date", { ascending: false });
    var rows = (r.data || []).map(function(a) {
      return { id: a.id, mission_date: a.mission_date, title: a.mission_title, status: a.status, submitted_at: a.submitted_at, completion_score: a.completion_score, counts_in_rate: a.counts_in_rate };
    });

    var stats = {
      total: rows.length,
      approved: rows.filter(function(r) { return r.status === ST.APPROVED || r.status === ST.LATE; }).length,
      pending: rows.filter(function(r) { return r.status === ST.SUBMITTED; }).length,
      rejected: rows.filter(function(r) { return countsAsMissing(r.status); }).length,
      rated: rows.filter(function(r) { return r.counts_in_rate; }).length,
      earned: rows.reduce(function(sum, r) { return sum + (r.completion_score || 0); }, 0),
    };
    setData({ rows: rows, stats: stats });
    setLoading(false);
  }, [member.id]);

  useEffect(function() { load(); }, [load]);

  async function deleteRecord(row) {
    if (!confirm(row.mission_date + " 기록을 완전히 삭제하시겠습니까?\n해당 회원의 인증 사진과 배정 이력이 함께 삭제됩니다.")) return;
    // 인증 사진 삭제 (스토리지 + proofs 행)
    var pr = await supabase.from("promotion_proofs").select("id,proof_file_path").eq("assignment_id", row.id);
    var proofs = pr.data || [];
    var paths = proofs.map(function(p) { return p.proof_file_path; }).filter(Boolean);
    if (paths.length) await supabase.storage.from(PROOF_BUCKET).remove(paths);
    if (proofs.length) await supabase.from("promotion_proofs").delete().eq("assignment_id", row.id);
    // 배정 이력 자체 삭제
    var del = await supabase.from("promotion_mission_assignments").delete().eq("id", row.id).select("id");
    if (del.error) { alert("삭제 실패: " + del.error.message); return; }
    if (!del.data || del.data.length === 0) { alert("DB에서 삭제되지 않았습니다(권한). Supabase에서 prototype-write-access.sql 실행을 확인해주세요."); return; }
    await load();
    if (props.onChanged) props.onChanged();
  }

  async function changeStatus(row, status) {
    if (!status || status === row.status) return;
    var updates = { status: status, reviewed_at: new Date().toISOString() };
    if (status === ST.PENDING || status === ST.MISSED || status === ST.REJECTED || status === ST.EXEMPTED) updates.submitted_at = null;
    if (status === ST.SUBMITTED && !row.submitted_at) updates.submitted_at = new Date().toISOString();
    var res = await supabase.from("promotion_mission_assignments").update(updates).eq("id", row.id);
    if (res.error) { alert("상태 변경 실패: " + res.error.message); return; }
    await load();
    if (props.onChanged) props.onChanged();
  }

  var rate = data && data.stats.rated > 0 ? Math.round(data.stats.earned / data.stats.rated * 100) : 0;

  return (
    <Modal onClose={props.onClose} maxWidth={860}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#3B72E8,#5A8EF5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 22, fontWeight: 900 }}>{member.name.slice(0, 1)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: INK }}>{member.name}</div>
          <div style={{ fontSize: 13, color: SUB }}>{member.gi + " · " + member.school}</div>
        </div>
      </div>

      {loading ? <div style={{ textAlign: "center", padding: 30, color: SUB }}>불러오는 중...</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(5, minmax(0, 1fr))", gap: isMobile ? 8 : 12, marginBottom: 16 }}>
            <StatMini label="총 담당" value={data.stats.total} color={INK} />
            <StatMini label="인증완료" value={data.stats.approved} color="#10A26A" />
            <StatMini label="제출됨" value={data.stats.pending} color={BLUE} />
            <StatMini label="사진반려" value={data.stats.rejected} color="#E04848" />
            <StatMini label="인증률" value={rate + "%"} color={rate >= 80 ? "#10A26A" : rate >= 50 ? BLUE : "#E05A00"} />
          </div>

          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>전체 인증 이력</div>
          {data.rows.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: SUB, background: "#F8FAFF", borderRadius: 12 }}>담당했던 미션이 없습니다.</div>
          ) : (
            <div style={{ border: "1px solid #F1F4F9", borderRadius: 12, overflow: isMobile ? "visible" : "hidden", padding: isMobile ? 8 : 0, background: isMobile ? "#F8FAFF" : "transparent" }}>
              <div style={{ display: isMobile ? "none" : "grid", gridTemplateColumns: "92px minmax(180px, 1.5fr) 96px minmax(150px, 1fr) 70px 150px", padding: "10px 14px", background: "#F8FAFF", fontSize: 12, fontWeight: 800, color: SUB }}>
                <div>날짜</div><div>미션</div><div>상태</div><div>특이사항</div><div>제출</div><div>관리</div>
              </div>
              {data.rows.map(function(r) {
                return (
                  <div key={r.mission_date} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : "92px minmax(180px, 1.5fr) 96px minmax(150px, 1fr) 70px 150px", gap: isMobile ? 8 : 0, padding: isMobile ? 12 : "12px 14px", marginTop: isMobile ? 8 : 0, borderTop: isMobile ? "none" : "1px solid #F1F4F9", borderRadius: isMobile ? 14 : 0, alignItems: isMobile ? "start" : "center", background: r.status === ST.REJECTED ? "#FFF8F8" : "#fff", columnGap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, gridColumn: isMobile ? "1 / 2" : "auto", whiteSpace: "nowrap" }}>{r.mission_date}</div>
                    <div style={{ fontSize: 12, color: "#4A5568", gridColumn: isMobile ? "1 / -1" : "auto", lineHeight: "17px", wordBreak: "keep-all", overflowWrap: "anywhere" }}>{r.title || "미션명 없음"}</div>
                    <div style={{ gridColumn: isMobile ? "2 / 3" : "auto", gridRow: isMobile ? "1 / 2" : "auto", justifySelf: isMobile ? "end" : "start" }}><span style={{ fontSize: 11, fontWeight: 700, color: stColor(r.status), background: stBg(r.status), padding: isMobile ? "5px 9px" : "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{stLabel(r.status)}</span></div>
                    <div style={{ fontSize: 11, lineHeight: "16px", color: r.status === ST.REJECTED ? "#E04848" : SUB, fontWeight: r.status === ST.REJECTED ? 700 : 500, gridColumn: isMobile ? "1 / -1" : "auto", wordBreak: "keep-all" }}>{stNote(r.status)}</div>
                    <div style={{ fontSize: 11, color: SUB, gridColumn: isMobile ? "1 / 2" : "auto", whiteSpace: "nowrap" }}>{r.submitted_at ? fmtTime(r.submitted_at) : "-"}</div>
                    <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                      <select value={r.status} onChange={function(e) { changeStatus(r, e.target.value); }} style={{ fontSize: 11, padding: "4px 6px", borderRadius: 8, border: "1px solid #DDE4F0", fontFamily: FONT, color: INK, maxWidth: 92 }}>
                        <option value={ST.SUBMITTED}>제출됨</option>
                        <option value={ST.APPROVED}>인증완료</option>
                        <option value={ST.LATE}>지각완료</option>
                        <option value={ST.PENDING}>미제출</option>
                        <option value={ST.MISSED}>미제출확정</option>
                        <option value={ST.REJECTED}>반려</option>
                        <option value={ST.EXEMPTED}>면제</option>
                      </select>
                      <button onClick={function() { deleteRecord(r); }} style={btnSmall({ background: "#FDECEC", color: "#E04848", padding: "4px 8px", fontSize: 11 })}>삭제</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function StatMini(props) {
  return (
    <div style={{ textAlign: "center", padding: 10, background: "#F8FAFF", borderRadius: 10 }}>
      <div style={{ fontSize: 11, color: SUB, fontWeight: 600 }}>{props.label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: props.color, marginTop: 2 }}>{props.value}</div>
    </div>
  );
}

/* ─── 관리자 인증 현황 (개별 삭제 포함) ─── */
function AdminCerts() {
  var winW = useWindowWidth();
  var isMobile = winW < 768;
  var today = todayKST();
  var _selDate = useState(today), selDate = _selDate[0], setSelDate = _selDate[1];
  var _proofs = useState([]), proofs = _proofs[0], setProofs = _proofs[1];
  var _mission = useState(null), mission = _mission[0], setMission = _mission[1];
  var _loading = useState(true), loading = _loading[0], setLoading = _loading[1];
  var _zoom = useState(null), zoom = _zoom[0], setZoom = _zoom[1];
  var _statusEdit = useState(null), statusEdit = _statusEdit[0], setStatusEdit = _statusEdit[1];
  var _statusValue = useState(ST.PENDING), statusValue = _statusValue[0], setStatusValue = _statusValue[1];
  var _statusReason = useState(""), statusReason = _statusReason[0], setStatusReason = _statusReason[1];
  var _statusBusy = useState(false), statusBusy = _statusBusy[0], setStatusBusy = _statusBusy[1];
  var _statusErr = useState(""), statusErr = _statusErr[0], setStatusErr = _statusErr[1];
  var _statusFilter = useState("all"), statusFilter = _statusFilter[0], setStatusFilter = _statusFilter[1];

  var load = useCallback(async function(date) {
    setLoading(true);
    var r1 = await supabase.from("promotion_missions").select("*").eq("mission_date", date).maybeSingle();
    setMission(r1.data || null);
    if (r1.data) {
      var r2 = await supabase.from("promotion_assignment_status_view").select("*").eq("mission_id", r1.data.id);
      var rp = await supabase.from("promotion_proofs").select("*").eq("mission_id", r1.data.id);
      var ra = await supabase.from("promotion_mission_assignments").select("id,status_reason").eq("mission_id", r1.data.id);
      var proofMap = {};
      (rp.data || []).forEach(function(p) { proofMap[p.assignment_id] = p; });
      var reasonMap = {};
      (ra.data || []).forEach(function(x) { reasonMap[x.id] = x.status_reason; });
      setProofs((r2.data || []).map(function(a) { return Object.assign({}, a, { proof: proofMap[a.id] || null, status_reason: (reasonMap[a.id] != null ? reasonMap[a.id] : a.status_reason) }); }).sort(function(a, b) {
        var ra = statusSortRank(a.status);
        var rb = statusSortRank(b.status);
        if (ra !== rb) return ra - rb;
        if (statusGroup(a.status) === "incomplete") {
          var ia = a.status === ST.PENDING ? 0 : a.status === ST.MISSED ? 1 : 2;
          var ib = b.status === ST.PENDING ? 0 : b.status === ST.MISSED ? 1 : 2;
          if (ia !== ib) return ia - ib;
        }
        return String(b.submitted_at || "").localeCompare(String(a.submitted_at || ""));
      }));
    } else { setProofs([]); }
    setLoading(false);
  }, []);

  useEffect(function() { load(selDate); }, [load, selDate]);

  async function decide(proof, status) {
    var reason = promptRequiredReason(stLabel(status) + " 처리 사유를 입력해 주세요.", status === ST.APPROVED ? "인증 확인" : "");
    if (!reason) return;
    var proofRow = proof.proof;
    if ((status === ST.APPROVED || status === ST.LATE) && proofRow && proofRow.proof_file_path) {
      await supabase.storage.from(PROOF_BUCKET).remove([proofRow.proof_file_path]);
      await supabase.from("promotion_proofs").update({ proof_image_url: null, proof_file_path: null }).eq("id", proofRow.id);
    }
    await supabase.from("promotion_mission_assignments").update({
      status: status,
      reviewed_at: new Date().toISOString(),
      status_reason: reason
    }).eq("id", proof.id);
    await load(selDate);
  }

  function openStatusEdit(proof) {
    setStatusEdit(proof);
    setStatusValue(proof.status || ST.PENDING);
    setStatusReason("");
    setStatusErr("");
  }

  async function applyStatusEdit() {
    if (!statusEdit) return;
    var status = statusValue;
    var reason = statusReason.trim();
    if (!reason) {
      setStatusErr("상태 변경 사유를 입력해 주세요.");
      return;
    }
    setStatusBusy(true);
    setStatusErr("");
    var updates = {
      status: status,
      reviewed_at: new Date().toISOString(),
      status_reason: reason
    };
    if (status === ST.PENDING || status === ST.MISSED || status === ST.REJECTED || status === ST.EXEMPTED) updates.submitted_at = null;
    if (status === ST.SUBMITTED && !statusEdit.submitted_at) updates.submitted_at = new Date().toISOString();
    if ((status === ST.APPROVED || status === ST.LATE) && statusEdit.proof && statusEdit.proof.proof_file_path) {
      await supabase.storage.from(PROOF_BUCKET).remove([statusEdit.proof.proof_file_path]);
      await supabase.from("promotion_proofs").update({ proof_image_url: null, proof_file_path: null }).eq("id", statusEdit.proof.id);
    }
    var res = await supabase.from("promotion_mission_assignments").update(updates).eq("id", statusEdit.id);
    if (res.error) {
      setStatusErr("상태 변경 중 오류가 발생했습니다: " + res.error.message);
      console.error(res.error);
      setStatusBusy(false);
      return;
    }
    setStatusBusy(false);
    setStatusEdit(null);
    await load(selDate);
  }

  async function deleteProof(proof) {
    if (!confirm(proof.member_name + "의 인증 기록을 삭제하시겠습니까?")) return;
    var reason = promptRequiredReason("인증 기록 삭제 사유를 입력해 주세요.", "인증 기록 삭제");
    if (!reason) return;
    if (proof.proof && proof.proof.proof_file_path) await supabase.storage.from(PROOF_BUCKET).remove([proof.proof.proof_file_path]);
    if (proof.proof) await supabase.from("promotion_proofs").delete().eq("id", proof.proof.id);
    await supabase.from("promotion_mission_assignments").update({ status: ST.PENDING, submitted_at: null, reviewed_at: new Date().toISOString(), status_reason: reason }).eq("id", proof.id);
    await load(selDate);
  }

  async function approveAllSubmitted() {
    var targets = proofs.filter(function(p) { return p.status === ST.SUBMITTED; });
    if (targets.length === 0) {
      alert("일괄승인할 제출 대기자가 없습니다.");
      return;
    }
    if (!confirm("제출 대기 " + targets.length + "명을 모두 승인하시겠습니까?\n승인된 인증 사진은 삭제됩니다.")) return;
    var reason = promptRequiredReason("일괄승인 사유를 입력해 주세요.", "바쁜 운영 상황으로 제출 대기 건 일괄승인");
    if (!reason) return;

    var filePaths = targets.map(function(p) { return p.proof && p.proof.proof_file_path; }).filter(Boolean);
    var proofIds = targets.map(function(p) { return p.proof && p.proof.id; }).filter(Boolean);
    var assignmentIds = targets.map(function(p) { return p.id; });

    if (filePaths.length) await supabase.storage.from(PROOF_BUCKET).remove(filePaths);
    if (proofIds.length) {
      var proofRes = await supabase.from("promotion_proofs").update({ proof_image_url: null, proof_file_path: null }).in("id", proofIds);
      if (proofRes.error) {
        alert("인증 사진 정리 중 오류가 발생했습니다.");
        console.error(proofRes.error);
        return;
      }
    }

    var res = await supabase.from("promotion_mission_assignments").update({
      status: ST.APPROVED,
      reviewed_at: new Date().toISOString(),
      status_reason: reason
    }).in("id", assignmentIds);
    if (res.error) {
      alert("일괄승인 중 오류가 발생했습니다.");
      console.error(res.error);
      return;
    }
    await load(selDate);
  }

  var approved = proofs.filter(function(p) { return p.status === ST.APPROVED || p.status === ST.LATE; }).length;
  var pending = proofs.filter(function(p) { return p.status === ST.SUBMITTED; }).length;
  var incomplete = proofs.filter(function(p) { return statusGroup(p.status) === "incomplete"; }).length;
  var visibleProofs = proofs.filter(function(p) {
    if (statusFilter === "all") return true;
    return statusGroup(p.status) === statusFilter;
  });
  function filterChip(label, count, key, color, bg) {
    var active = statusFilter === key;
    return (
      <button onClick={function() { setStatusFilter(active ? "all" : key); }}
        style={{ border: active ? "1px solid " + color : "1px solid transparent", cursor: "pointer", fontFamily: FONT, fontSize: isMobile ? 11 : 13, fontWeight: 900, color: color, background: active ? "#fff" : bg, padding: isMobile ? "5px 9px" : "5px 14px", borderRadius: 999, whiteSpace: "nowrap", boxShadow: active ? "0 6px 16px rgba(33,64,120,0.10)" : "none" }}>
        {label + " " + count}
      </button>
    );
  }

  return (
    <div>
      <div style={{ fontSize: isMobile ? 22 : 24, fontWeight: 900, color: INK, marginBottom: isMobile ? 10 : 16, textAlign: isMobile ? "left" : "inherit" }}>인증 현황</div>
      <div style={{ display: "flex", gap: isMobile ? 7 : 14, alignItems: "center", marginBottom: isMobile ? 10 : 18, flexDirection: isMobile ? "column" : "row" }}>
        <input style={Object.assign({}, aInput(), { width: "100%", maxWidth: isMobile ? "none" : 180, padding: isMobile ? "9px 11px" : "10px 14px", fontSize: isMobile ? 12 : 14 })} type="date" value={selDate} onChange={function(e) { setSelDate(e.target.value); }} />
        <div style={{ display: "flex", gap: 6, width: isMobile ? "100%" : "auto", alignItems: "center", flexWrap: "wrap" }}>
          {filterChip("대기", pending, "pending", BLUE, "#E8F0FE")}
          {filterChip("미완료", incomplete, "incomplete", "#E04848", "#FDECEC")}
          {filterChip("완료", approved, "done", "#10A26A", "#E6F8EF")}
          <button onClick={approveAllSubmitted} disabled={pending === 0} style={btnSmall({ background: pending ? "#10A26A" : "#E5EAF2", color: pending ? "#fff" : SUB, padding: isMobile ? "6px 9px" : "6px 14px", fontSize: isMobile ? 11 : 12, borderRadius: 10, marginLeft: "auto", whiteSpace: "nowrap" })}>대기 일괄승인</button>
        </div>
      </div>

      {loading ? <div style={{ color: SUB }}>불러오는 중...</div> :
       !mission ? <div style={{ color: SUB }}>해당 날짜의 미션이 없습니다.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 5 : 10 }}>
          {visibleProofs.map(function(proof) {
            var status = proof.status;
            var isSkip = String(proof.status_reason || "").indexOf("건너뛰기") !== -1;
            if (isMobile) {
              return (
                <div key={proof.id} style={{ background: "#fff", borderRadius: 12, padding: "7px 8px", boxShadow: "0 4px 12px rgba(33,64,120,0.05)", border: "1px solid #EDF2FA" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6, alignItems: "center", marginBottom: 5 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 900, color: INK, whiteSpace: "nowrap" }}>{proof.member_name}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>- {proof.school}</span>
                      </div>
                      <div style={{ fontSize: 10, color: SUB, fontWeight: 800, marginTop: 1 }}>{proof.gi}{proof.submitted_at ? " · " + fmtTime(proof.submitted_at) : ""}{isSkip ? " · 건너뛰기" : ""}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {isSkip && <span style={{ fontSize: 10, fontWeight: 900, color: "#0869F4", background: "#EAF2FF", padding: "3px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>건너뛰기</span>}
                      <button onClick={function() { openStatusEdit(proof); }} style={{ border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 10, fontWeight: 900, color: stColor(status), background: stBg(status), padding: "4px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{stLabel(status)}</button>
                    </div>
                  </div>
                  {proof.proof && (
                    <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 1 }}>
                      {proof.proof.proof_image_url && (
                        <button onClick={function() { setZoom(proof); }} style={btnSmall({ background: "#F0F4FB", color: BLUE, padding: "5px 7px", fontSize: 10, borderRadius: 8, whiteSpace: "nowrap" })}>캡처</button>
                      )}
                      <button onClick={function() { deleteProof(proof); }} style={btnSmall({ background: "#FDECEC", color: "#E04848", padding: "5px 7px", fontSize: 10, borderRadius: 8, whiteSpace: "nowrap" })}>삭제</button>
                    </div>
                  )}
                </div>
              );
            }
            return (
              <div key={proof.id} style={card({ display: "flex", alignItems: isMobile ? "flex-start" : "center", gap: 14, padding: 16, flexDirection: isMobile ? "column" : "row" })}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#3B72E8,#5A8EF5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, flexShrink: 0 }}>{proof.member_name.slice(0, 1)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{proof.member_name}</div>
                  <div style={{ fontSize: 12, color: SUB }}>{proof.gi + " · " + proof.school}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: stColor(status), background: stBg(status), padding: "5px 14px", borderRadius: 999 }}>{stLabel(status)}</span>
                {isSkip && <span style={{ fontSize: 12, fontWeight: 800, color: "#0869F4", background: "#EAF2FF", padding: "5px 12px", borderRadius: 999 }}>건너뛰기</span>}
                {proof.proof && proof.proof.proof_image_url && (
                  <button onClick={function() { setZoom(proof); }} style={btnSmall({ background: "#F0F4FB", color: BLUE })}>캡처 보기</button>
                )}
                {proof.status === ST.SUBMITTED && (
                  <>
                    <button onClick={function() { decide(proof, ST.APPROVED); }} style={btnSmall({ background: "#10A26A", color: "#fff" })}>승인</button>
                    <button onClick={function() { decide(proof, ST.LATE); }} style={btnSmall({ background: "#FFF4E5", color: "#E05A00" })}>지각</button>
                    <button onClick={function() { decide(proof, ST.REJECTED); }} style={btnSmall({ background: "#E04848", color: "#fff" })}>반려</button>
                  </>
                )}
                <button onClick={function() { openStatusEdit(proof); }} style={btnSmall({ background: "#F0F4FB", color: BLUE })}>상태 변경</button>
                {proof.proof && (
                  <button onClick={function() { deleteProof(proof); }} style={btnSmall({ background: "#FDECEC", color: "#E04848" })}>삭제</button>
                )}
              </div>
            );
          })}
          {visibleProofs.length === 0 && (
            <div style={card({ textAlign: "center", color: SUB, fontSize: 13, fontWeight: 800, padding: 24 })}>선택한 상태의 인원이 없습니다.</div>
          )}
        </div>
      )}

      {zoom && (
        <Modal onClose={function() { setZoom(null); }} maxWidth={560}>
          <SecureProofImage src={zoom.proof.proof_image_url} path={zoom.proof.proof_file_path} alt="인증 캡처" style={{ width: "100%", borderRadius: 12, maxHeight: 500, objectFit: "contain" }} />
          <div style={{ marginTop: 12, fontSize: 13, color: SUB }}>제출: {fmtTime(zoom.submitted_at)} · {zoom.member_name}</div>
        </Modal>
      )}

      {statusEdit && (
        <Modal onClose={function() { if (!statusBusy) setStatusEdit(null); }} maxWidth={520}>
          <div style={{ fontSize: 20, fontWeight: 900, color: INK, marginBottom: 6 }}>상태 변경</div>
          <div style={{ fontSize: 13, color: SUB, fontWeight: 700, marginBottom: 18 }}>{statusEdit.member_name + " · 현재 " + stLabel(statusEdit.status)}</div>
          <AField label="변경할 상태">
            <select style={aInput()} value={statusValue} onChange={function(e) { setStatusValue(e.target.value); }}>
              <option value={ST.SUBMITTED}>제출됨</option>
              <option value={ST.PENDING}>미제출</option>
              <option value={ST.MISSED}>미제출 확정</option>
              <option value={ST.REJECTED}>반려</option>
              <option value={ST.APPROVED}>인증 완료</option>
              <option value={ST.LATE}>지각 완료</option>
              <option value={ST.EXEMPTED}>면제</option>
            </select>
          </AField>
          <AField label="변경 사유 *">
            <textarea style={Object.assign({}, aInput(), { height: 96, resize: "vertical" })} value={statusReason} placeholder="예: 관리자 확인 후 면제 처리" onChange={function(e) { setStatusReason(e.target.value); }} />
          </AField>
          {statusErr && <div style={{ fontSize: 13, color: "#E04848", fontWeight: 800, marginBottom: 10 }}>{statusErr}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnGhost()} disabled={statusBusy} onClick={function() { setStatusEdit(null); }}>취소</button>
            <button style={btnPrimary({ opacity: statusBusy ? 0.65 : 1 })} disabled={statusBusy} onClick={applyStatusEdit}>{statusBusy ? "저장 중..." : "저장"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AdminUncert() {
  var winW = useWindowWidth();
  var isMobile = winW < 768;
  var today = todayKST();
  var _selDate = useState(today), selDate = _selDate[0], setSelDate = _selDate[1];
  var _mission = useState(null), mission = _mission[0], setMission = _mission[1];
  var _proofs = useState([]), proofs = _proofs[0], setProofs = _proofs[1];
  var _members = useState([]), members = _members[0], setMembers = _members[1];
  var _loading = useState(true), loading = _loading[0], setLoading = _loading[1];
  var _copyMsg = useState(""), copyMsg = _copyMsg[0], setCopyMsg = _copyMsg[1];
  var _noticeText = useState(""), noticeText = _noticeText[0], setNoticeText = _noticeText[1];
  var _noticeEdited = useState(false), noticeEdited = _noticeEdited[0], setNoticeEdited = _noticeEdited[1];
  var _statusEdit = useState(null), statusEdit = _statusEdit[0], setStatusEdit = _statusEdit[1];
  var _statusValue = useState(ST.PENDING), statusValue = _statusValue[0], setStatusValue = _statusValue[1];
  var _statusReason = useState(""), statusReason = _statusReason[0], setStatusReason = _statusReason[1];
  var _statusBusy = useState(false), statusBusy = _statusBusy[0], setStatusBusy = _statusBusy[1];
  var _statusErr = useState(""), statusErr = _statusErr[0], setStatusErr = _statusErr[1];
  var nowMs = useNowMs(60000);

  useEffect(function() {
    (async function() {
      setLoading(true);
      setCopyMsg("");
      setNoticeText("");
      setNoticeEdited(false);
      var r1 = await supabase.from("promotion_missions").select("*").eq("mission_date", selDate).maybeSingle();
      setMission(r1.data || null);
      var r2 = await supabase.from("members").select(LEGACY_MEMBER_FIELDS).eq("status", "active");
      setMembers(r2.data || []);
      if (r1.data) {
        var r3 = await supabase.from("promotion_assignment_status_view").select("*").eq("mission_id", r1.data.id);
        setProofs(r3.data || []);
      } else {
        setProofs([]);
      }
      setLoading(false);
    })();
  }, [selDate]);

  if (loading) return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 900, color: INK, marginBottom: 8 }}>미인증자 관리</div>
      <div style={{ color: SUB }}>불러오는 중...</div>
    </div>
  );

  var uncertified = proofs.filter(function(p) {
    return p.status === ST.PENDING || p.status === ST.MISSED || p.status === ST.REJECTED;
  });
  var remainingText = "잔여시간 -";
  var dueOpen = false;
  if (mission && mission.due_at) {
    var leftMs = new Date(mission.due_at).getTime() - nowMs;
    dueOpen = leftMs > 0;
    if (leftMs > 0) {
      var leftH = Math.floor(leftMs / 3600000);
      var leftM = Math.floor((leftMs % 3600000) / 60000);
      remainingText = "잔여시간 " + leftH + "시간 " + leftM + "분";
    } else {
      remainingText = "마감 시간이 지났습니다";
    }
  }

  function displayMember(m) {
    return m.member_name + " - " + m.school + " (" + m.gi + ")";
  }

  async function markMissed() {
    if (!mission) return;
    if (new Date() <= new Date(mission.due_at)) {
      setCopyMsg("마감 시간이 지난 후 미제출 확정을 할 수 있습니다.");
      return;
    }
    var targets = proofs.filter(function(p) { return p.status === ST.PENDING; });
    if (targets.length === 0) {
      setCopyMsg("미제출 확정할 대상자가 없습니다.");
      return;
    }
    if (!confirm("현재 미제출 " + targets.length + "명을 missed로 확정하시겠습니까?")) return;
    var reason = promptRequiredReason("미제출 확정 사유를 입력해 주세요.", "마감 후 미제출 자동확정");
    if (!reason) return;
    var ids = targets.map(function(p) { return p.id; });
    var res = await supabase.from("promotion_mission_assignments").update({
      status: ST.MISSED,
      reviewed_at: new Date().toISOString(),
      status_reason: reason
    }).in("id", ids);
    if (res.error) {
      setCopyMsg("미제출 확정 중 오류가 발생했습니다.");
      console.error(res.error);
      return;
    }
    setProofs(function(prev) {
      return prev.map(function(p) {
        return ids.indexOf(p.id) !== -1 ? Object.assign({}, p, { status: ST.MISSED }) : p;
      });
    });
    setCopyMsg("미제출 " + targets.length + "명을 확정했습니다.");
  }

  function buildNotice() {
    var missionLine = mission.title || "오늘 홍보 미션";
    var deadlineLine = fmtTime(mission.due_at) || "마감 시간 확인 필요";
    var people = uncertified.map(function(m) { return "- " + displayMember(m); }).join("\n");
    return [
      "[MAST 홍보 미션 미완료 안내]",
      "",
      "오늘 홍보 미션 미완료자가 있습니다.",
      "마감 전까지 인증 제출 부탁드립니다.",
      "",
      "미션: " + missionLine,
      "마감: " + deadlineLine,
      remainingText,
      "",
      "미완료자:",
      people,
      "",
      "동명이인 확인을 위해 이름 옆에 기수와 학교를 함께 표기했습니다."
    ].join("\n");
  }

  var noticeDraft = mission ? (noticeEdited ? noticeText : buildNotice()) : "";

  function resetNoticeDraft() {
    setNoticeText("");
    setNoticeEdited(false);
    setCopyMsg("안내문 초안을 다시 만들었습니다.");
  }

  async function copyNotice() {
    var message = noticeDraft;
    setNoticeText(message);
    setNoticeEdited(true);

    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(message);
      setCopyMsg("안내문을 복사했습니다.");
    } catch {
      try {
        var el = document.createElement("textarea");
        el.value = message;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(el);
        setCopyMsg(ok ? "안내문을 복사했습니다." : "아래 안내문을 직접 복사해 주세요.");
      } catch {
        setCopyMsg("아래 안내문을 직접 복사해 주세요.");
      }
    }
  }

  function openStatusEdit(row) {
    setStatusEdit(row);
    setStatusValue(row.status || ST.PENDING);
    setStatusReason("");
    setStatusErr("");
  }

  async function applyStatusEdit() {
    if (!statusEdit) return;
    var status = statusValue;
    var reason = statusReason.trim();
    if (!reason) {
      setStatusErr("상태 변경 사유를 입력해 주세요.");
      return;
    }
    setStatusBusy(true);
    setStatusErr("");
    var updates = {
      status: status,
      reviewed_at: new Date().toISOString(),
      status_reason: reason
    };
    if (status === ST.PENDING || status === ST.MISSED || status === ST.REJECTED || status === ST.EXEMPTED) updates.submitted_at = null;
    if (status === ST.SUBMITTED && !statusEdit.submitted_at) updates.submitted_at = new Date().toISOString();
    var res = await supabase.from("promotion_mission_assignments").update(updates).eq("id", statusEdit.id);
    if (res.error) {
      setStatusErr("상태 변경 중 오류가 발생했습니다: " + res.error.message);
      console.error(res.error);
      setStatusBusy(false);
      return;
    }
    setProofs(function(prev) {
      return prev.map(function(p) {
        return p.id === statusEdit.id ? Object.assign({}, p, updates) : p;
      });
    });
    setStatusBusy(false);
    setStatusEdit(null);
    setCopyMsg(statusEdit.member_name + " 상태를 변경했습니다.");
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: isMobile ? 8 : 18 }}>
        <div>
          <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: INK, lineHeight: isMobile ? "25px" : "30px" }}>미인증자 관리</div>
          {mission && <div style={{ fontSize: isMobile ? 11 : 13, color: SUB, marginTop: 2, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: isMobile ? 210 : "none" }}>{mission.title} · {uncertified.length}명</div>}
        </div>
        <input style={Object.assign({}, aInput(), { width: isMobile ? 128 : 180, padding: isMobile ? "8px 9px" : "10px 14px", fontSize: isMobile ? 12 : 14, borderRadius: 10 })} type="date" value={selDate} onChange={function(e) { setSelDate(e.target.value); }} />
      </div>

      {!mission ? (
        <div style={{ color: SUB, fontSize: 14 }}>선택한 날짜의 미션이 없습니다.</div>
      ) : uncertified.length === 0 ? (
        <div style={card({ textAlign: "center", padding: 30 })}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}><IconParty /></div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#10A26A" }}>모든 담당자가 인증을 완료했습니다!</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 7 : 10 }}>
          <div style={card({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: isMobile ? 9 : 14, flexDirection: "row", borderRadius: isMobile ? 16 : 24 })}>
            <div>
              <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 900, color: INK }}>안내문</div>
              {!isMobile && <div style={{ fontSize: 12, color: SUB, marginTop: 3 }}>이름(기수, 학교) 형식으로 미완료자를 구분해서 복사합니다.</div>}
              {copyMsg && <div style={{ fontSize: 11, color: "#10A26A", fontWeight: 800, marginTop: 2, maxWidth: isMobile ? 150 : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{copyMsg}</div>}
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button onClick={markMissed} style={btnSmall({ background: "#FDECEC", color: "#E04848", padding: isMobile ? "8px 9px" : "10px 16px", fontSize: isMobile ? 11 : 13, borderRadius: 10 })}>확정</button>
              <button onClick={resetNoticeDraft} style={btnSmall({ background: "#F8FAFF", border: "1px solid #DDE4F0", color: BLUE, padding: isMobile ? "8px 9px" : "10px 16px", fontSize: isMobile ? 11 : 13, borderRadius: 10 })}>초안</button>
              <button onClick={copyNotice} style={btnPrimary({ width: "auto", padding: isMobile ? "8px 10px" : "10px 16px", fontSize: isMobile ? 11 : 13, borderRadius: 10 })}>복사</button>
            </div>
          </div>
          <textarea
            value={noticeDraft}
            onChange={function(e) { setNoticeEdited(true); setNoticeText(e.target.value); }}
            onFocus={function(e) { e.target.select(); }}
            placeholder="미인증자 안내문을 수정한 뒤 복사할 수 있습니다."
            style={Object.assign({}, aInput(), { minHeight: isMobile ? 168 : 190, resize: "vertical", fontSize: isMobile ? 11 : 12, lineHeight: 1.6, whiteSpace: "pre-wrap", borderRadius: isMobile ? 16 : 18 })}
          />
          <div style={card({ padding: isMobile ? 8 : 16, background: "#F8FBFF", border: "1px solid #E5EAF2", borderRadius: isMobile ? 16 : 24 })}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 900, color: INK }}>공지용 미인증자</div>
                <div style={{ fontSize: 11, color: SUB, fontWeight: 800, marginTop: 2 }}>{uncertified.length}명</div>
              </div>
              <div style={{ borderRadius: 999, background: dueOpen ? "#E8F8F2" : "#FFF1F1", color: dueOpen ? "#00A879" : "#E04848", padding: isMobile ? "6px 9px" : "8px 13px", fontSize: isMobile ? 11 : 13, fontWeight: 900, whiteSpace: "nowrap", flexShrink: 0 }}>{remainingText}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 5 : 8 }}>
              {uncertified.map(function(m) {
                return (
                  <div key={m.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 6, padding: isMobile ? "5px 7px" : "10px 12px", borderRadius: isMobile ? 8 : 12, background: "#fff", border: "1px solid #E9EEF7", minHeight: isMobile ? 30 : "auto" }}>
                    <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 5 }}>
                      <span style={{ fontSize: isMobile ? 11 : 13, fontWeight: 900, color: INK, whiteSpace: "nowrap", flexShrink: 0 }}>{m.member_name}</span>
                      <span style={{ fontSize: isMobile ? 10 : 12, fontWeight: 800, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>- {m.school}</span>
                    </div>
                    <button onClick={function() { openStatusEdit(m); }} style={{ border: "none", cursor: "pointer", fontFamily: FONT, fontSize: isMobile ? 9 : 10, fontWeight: 900, color: stColor(m.status), background: stBg(m.status), padding: isMobile ? "3px 6px" : "4px 8px", borderRadius: 999, flexShrink: 0 }}>{stLabel(m.status)}</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {statusEdit && (
        <Modal onClose={function() { if (!statusBusy) setStatusEdit(null); }} maxWidth={520}>
          <div style={{ fontSize: 20, fontWeight: 900, color: INK, marginBottom: 6 }}>상태 변경</div>
          <div style={{ fontSize: 13, color: SUB, fontWeight: 700, marginBottom: 18 }}>{statusEdit.member_name + " · 현재 " + stLabel(statusEdit.status)}</div>
          <AField label="변경할 상태">
            <select style={aInput()} value={statusValue} onChange={function(e) { setStatusValue(e.target.value); }}>
              <option value={ST.SUBMITTED}>제출됨</option>
              <option value={ST.PENDING}>미제출</option>
              <option value={ST.MISSED}>미제출 확정</option>
              <option value={ST.REJECTED}>반려</option>
              <option value={ST.APPROVED}>인증 완료</option>
              <option value={ST.LATE}>지각 완료</option>
              <option value={ST.EXEMPTED}>면제</option>
            </select>
          </AField>
          <AField label="변경 사유 *">
            <textarea style={Object.assign({}, aInput(), { height: 96, resize: "vertical" })} value={statusReason} placeholder="예: 관리자 확인 후 면제 처리" onChange={function(e) { setStatusReason(e.target.value); }} />
          </AField>
          {statusErr && <div style={{ fontSize: 13, color: "#E04848", fontWeight: 800, marginBottom: 10 }}>{statusErr}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnGhost()} disabled={statusBusy} onClick={function() { setStatusEdit(null); }}>취소</button>
            <button style={btnPrimary({ opacity: statusBusy ? 0.65 : 1 })} disabled={statusBusy} onClick={applyStatusEdit}>{statusBusy ? "저장 중..." : "저장"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════
   공통 UI
═══════════════════════════════════════════════════ */
function Modal(props) {
  return (
    <div onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
      <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#fff", borderRadius: 22, padding: 24, maxWidth: props.maxWidth || 520, width: "100%", maxHeight: "85vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        {props.children}
        <div style={{ marginTop: 18, textAlign: "right" }}>
          <button style={btnGhost({ width: "auto", padding: "10px 24px" })} onClick={props.onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
function PageHeader(props) {
  return <div style={{ display: "flex", alignItems: "center", padding: "22px 0 18px" }}><div style={{ fontSize: 20, fontWeight: 800, color: INK }}>{props.title}</div></div>;
}
function CenteredMsg(props) { return <div style={{ padding: "60px 24px", textAlign: "center", fontSize: 15, color: SUB }}>{props.msg}</div>; }
function AField(props) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginBottom: 6 }}>{props.label}</div>
      {props.children}
    </div>
  );
}
function Planet(props) { return <div style={Object.assign({ position: "absolute", borderRadius: "50%", boxShadow: "inset -8px -8px 16px rgba(0,0,0,0.08), 0 4px 12px rgba(60,100,200,0.1)", pointerEvents: "none" }, props.style)} />; }
function Orb(props) {
  return (
    <div style={Object.assign({
      position: "absolute",
      borderRadius: "50%",
      background: "radial-gradient(circle at 32% 28%, #FFFFFF 0%, #B8D0F4 35%, #6FA3F0 100%)",
      boxShadow: "inset -3px -5px 10px rgba(60,100,200,0.25), 0 8px 20px rgba(60,100,200,0.18)",
      pointerEvents: "none"
    }, props.style)} />
  );
}
function YellowOrb(props) {
  return (
    <div style={Object.assign({ position: "absolute", pointerEvents: "none", width: props.style.width }, props.style)}>
      <div style={{
        width: "100%", paddingBottom: "100%", borderRadius: "50%",
        background: "radial-gradient(circle at 30% 28%, #FFFFFF 0%, #FDE8B2 30%, #F4B860 100%)",
        boxShadow: "inset -3px -5px 10px rgba(180,120,30,0.2), 0 8px 20px rgba(244,184,96,0.25)"
      }} />
    </div>
  );
}
function SaturnOrb(props) {
  var w = props.style.width || 130;
  return (
    <div style={Object.assign({ position: "absolute", pointerEvents: "none", width: w }, props.style)}>
      <svg viewBox="0 0 140 100" width={w} height={w * 100 / 140}>
        <defs>
          <radialGradient id="satplanet" cx="0.32" cy="0.28">
            <stop offset="0%" stopColor="#FFFFFF"/>
            <stop offset="35%" stopColor="#FDE8B2"/>
            <stop offset="100%" stopColor="#F4B860"/>
          </radialGradient>
          <linearGradient id="satring" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#E8D4A3" stopOpacity="0.4"/>
            <stop offset="50%" stopColor="#FBF1DC" stopOpacity="0.9"/>
            <stop offset="100%" stopColor="#E8D4A3" stopOpacity="0.4"/>
          </linearGradient>
        </defs>
        {/* 뒤쪽 고리 */}
        <path d="M 12 52 Q 70 22 128 52" fill="none" stroke="url(#satring)" strokeWidth="6" />
        {/* 행성 본체 */}
        <circle cx="70" cy="50" r="38" fill="url(#satplanet)" />
        {/* 앞쪽 고리 */}
        <path d="M 12 52 Q 70 82 128 52" fill="none" stroke="url(#satring)" strokeWidth="6" />
      </svg>
    </div>
  );
}
function SaturnRing(props) {
  return (
    <div style={Object.assign({ position: "absolute", pointerEvents: "none" }, props.style)}>
      <svg width="120" height="80" viewBox="0 0 120 80">
        <defs>
          <radialGradient id="sat" cx="0.4" cy="0.4">
            <stop offset="0%" stopColor="#FDE8B2" />
            <stop offset="100%" stopColor="#F4B860" />
          </radialGradient>
        </defs>
        <ellipse cx="60" cy="40" rx="50" ry="14" fill="none" stroke="#E8D4A3" strokeWidth="3" opacity="0.6" />
        <circle cx="60" cy="40" r="28" fill="url(#sat)" />
      </svg>
    </div>
  );
}
function IconInput(props) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#9AA3B2", display: "flex" }}>{props.icon}</span>
      <input style={Object.assign({}, inputSt(), props.right ? { paddingRight: 50 } : {})}
        type={props.type || "text"} value={props.value} placeholder={props.placeholder}
        onChange={function(e) { props.onChange(e.target.value); }}
        onKeyDown={function(e) { if (e.key === "Enter" && props.onEnter) props.onEnter(); }} />
      {props.right && <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)" }}>{props.right}</span>}
    </div>
  );
}

function card(extra) { return Object.assign({ background: "#fff", borderRadius: 24, padding: 20, boxShadow: "0 12px 32px rgba(33,64,120,0.08)", boxSizing: "border-box" }, extra); }
function homeCard(extra) { return Object.assign({ background: "#fff", borderRadius: 24, padding: 24, boxShadow: "0 12px 32px rgba(33,64,120,0.08)", boxSizing: "border-box", marginBottom: 16 }, extra); }
function homeHeroCard(extra) { return Object.assign({ height: 272, background: "transparent", borderRadius: 0, boxShadow: "none", marginBottom: 16, position: "relative", overflow: "visible" }, extra); }
function NamePill(props) {
  return (
    <div style={{ minWidth: 0, height: 30, borderRadius: 15, background: props.submitted ? "#E8F8F2" : "#F0F2F7", color: props.submitted ? "#00A879" : "#08235E", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 14, fontWeight: 950, padding: "0 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{props.name}</span>
      {props.mine && <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#0869F4", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>나</span>}
    </div>
  );
}
function PostCopyBox(props) {
  var empty = !props.text;
  return (
    <div style={{ border: "1px solid #E5EAF2", borderRadius: 16, background: "#F8FAFF", padding: 12, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "#66728A" }}>{props.label}</div>
        <button disabled={empty} onClick={function() { props.onCopy(props.label, props.text); }} style={btnSmall({ width: "auto", borderRadius: 12, padding: "7px 12px", background: empty ? "#E5EAF2" : "#0869F4", color: empty ? "#8F99AA" : "#fff" })}>복붙</button>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.65, color: empty ? "#9AA3B2" : INK, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{empty ? "입력된 내용이 없습니다." : props.text}</div>
    </div>
  );
}
function inputSt() { return { width: "100%", boxSizing: "border-box", border: "none", borderRadius: 22, padding: "18px 20px 18px 38px", fontSize: 15, fontFamily: FONT, color: INK, background: "rgba(255,255,255,0.92)", outline: "none", boxShadow: "0 4px 14px rgba(60,100,200,0.08)", textAlign: "center" }; }
function aInput() { return { width: "100%", boxSizing: "border-box", border: "1px solid #DDE4F0", borderRadius: 10, padding: "10px 14px", fontSize: 14, fontFamily: FONT, color: INK, background: "#fff", outline: "none" }; }
function btnPrimary(extra) { return Object.assign({ border: "none", borderRadius: 14, padding: "15px 0", fontSize: 16, fontWeight: 800, cursor: "pointer", fontFamily: FONT, width: "100%", background: "linear-gradient(135deg,#5C8AE8,#3B72E8)", color: "#fff", boxShadow: "0 8px 22px rgba(59,114,232,0.35)" }, extra); }
function btnGhost(extra) { return Object.assign({ border: "1px solid #E5EAF2", borderRadius: 14, padding: "13px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT, width: "100%", background: "#F8FAFF", color: SUB }, extra); }
function btnSmall(extra) { return Object.assign({ border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }, extra); }

/* ════════════════════════════════════════════════
   SVG ICONS (입체감 있는 3D 풍 + 평면 라인)
═══════════════════════════════════════════════════ */
function IconUser() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function IconCap() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>; }
function IconSchool() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 21h18M5 21V7l8-4 8 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h6"/></svg>; }
function IconLock() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>; }
function IconEye() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IconEyeOff() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>; }
function IconHelp() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A96AB" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12" y2="17"/></svg>; }
function IconHand() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="#FBBF24" stroke="none"><path d="M12 2c-1.1 0-2 .9-2 2v7H8V6c0-1.1-.9-2-2-2s-2 .9-2 2v10c0 3.3 2.7 6 6 6h2c3.3 0 6-2.7 6-6V8c0-1.1-.9-2-2-2s-2 .9-2 2v3h-2V4c0-1.1-.9-2-2-2z"/></svg>; }
function IconBell(props) { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={props.color || "#1A2340"} strokeWidth="2" strokeLinecap="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>; }
function IconClock(props) { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={props.color || "currentColor"} strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IconCheck(props) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={props.color || "#10A26A"} strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IconDot(props) { return <span style={{ display: "inline-block", width: props.size || 10, height: props.size || 10, borderRadius: "50%", background: props.color }} />; }
function IconAttach(props) { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={props.color || "currentColor"} strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>; }
function IconSchoolSolid(props) {
  if (props && props.type === "cap") {
    return <svg width="24" height="24" viewBox="0 0 24 24" fill="#0869F4"><path d="M12 3 1.8 8.4 12 14l8-4.4V16h2V8.4L12 3Z"/><path d="M6 12.2v3.5c2.9 2.4 9.1 2.4 12 0v-3.5L12 15.5l-6-3.3Z"/></svg>;
  }
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="#0869F4"><path d="M3 10.2 12 4l9 6.2v2H3v-2Z"/><path d="M5 13h3v6H5v-6Zm5.5 0h3v6h-3v-6Zm5.5 0h3v6h-3v-6ZM3 20h18v2H3v-2Z"/></svg>;
}
function IconDownload() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>; }
function IconInbox() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <defs>
        <linearGradient id="ibg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#C5D8FB"/><stop offset="100%" stopColor="#6FA3F0"/></linearGradient>
      </defs>
      <rect x="6" y="14" width="44" height="32" rx="6" fill="url(#ibg)"/>
      <path d="M6 28h12l4 5h12l4-5h12" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconLockBig() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <defs>
        <linearGradient id="lbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#C5D8FB"/><stop offset="100%" stopColor="#6FA3F0"/></linearGradient>
      </defs>
      <rect x="10" y="24" width="36" height="26" rx="5" fill="url(#lbg)"/>
      <path d="M16 24v-6a12 12 0 0124 0v6" stroke="#6FA3F0" strokeWidth="4" fill="none" strokeLinecap="round"/>
      <circle cx="28" cy="37" r="4" fill="#fff"/>
    </svg>
  );
}
function IconParty() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <defs>
        <linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#3DC489"/><stop offset="100%" stopColor="#10A26A"/></linearGradient>
      </defs>
      <circle cx="28" cy="28" r="22" fill="url(#pg)"/>
      <polyline points="18 28 25 35 38 21" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="48" cy="10" r="2" fill="#FBBF24"/>
      <circle cx="8" cy="14" r="2" fill="#3B72E8"/>
      <circle cx="50" cy="46" r="2" fill="#E04848"/>
    </svg>
  );
}
function CheckMarkBig() {
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <defs>
        <linearGradient id="cmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#3DC489"/><stop offset="100%" stopColor="#10A26A"/></linearGradient>
      </defs>
      <circle cx="55" cy="55" r="44" fill="url(#cmg)"/>
      <polyline points="37 55 50 68 75 42" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="90" y="20" width="6" height="6" fill="#FBBF24" transform="rotate(45 93 23)"/>
      <rect x="12" y="30" width="5" height="5" fill="#3B72E8" transform="rotate(45 14.5 32.5)"/>
      <rect x="95" y="80" width="5" height="5" fill="#E04848" transform="rotate(45 97.5 82.5)"/>
      <rect x="8" y="78" width="6" height="6" fill="#3DC489" transform="rotate(45 11 81)"/>
    </svg>
  );
}
function CameraIcon(props) {
  var s = props && props.size || 32;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64">
      <defs>
        <linearGradient id="camg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#A8C4F8"/><stop offset="100%" stopColor="#3B72E8"/></linearGradient>
        <radialGradient id="camLens" cx="0.4" cy="0.4"><stop offset="0%" stopColor="#fff"/><stop offset="100%" stopColor="#3B72E8"/></radialGradient>
      </defs>
      <rect x="6" y="20" width="52" height="36" rx="6" fill="url(#camg)"/>
      <rect x="22" y="14" width="20" height="10" rx="2" fill="#5A8EF5"/>
      <circle cx="32" cy="38" r="11" fill="url(#camLens)"/>
      <circle cx="32" cy="38" r="6" fill="#1A2340" opacity="0.7"/>
    </svg>
  );
}
function MegaphoneBig() {
  return (
    <svg width="240" height="180" viewBox="0 0 240 180">
      <defs>
        <linearGradient id="mgBody" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7BA5F2"/>
          <stop offset="100%" stopColor="#3B72E8"/>
        </linearGradient>
        <linearGradient id="mgBell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF"/>
          <stop offset="100%" stopColor="#C5D8FB"/>
        </linearGradient>
        <linearGradient id="mgHandle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5A8EF5"/>
          <stop offset="100%" stopColor="#3B72E8"/>
        </linearGradient>
        <linearGradient id="mgYellow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFD97A"/>
          <stop offset="100%" stopColor="#F4B860"/>
        </linearGradient>
      </defs>
      {/* 그림자 */}
      <ellipse cx="130" cy="170" rx="80" ry="6" fill="#1A2340" opacity="0.08"/>
      {/* 본체 (왼쪽 좁고 오른쪽 넓어지는 메가폰) */}
      <path d="M75 75 Q70 75 70 80 L70 110 Q70 115 75 115 L120 110 L120 80 Z" fill="url(#mgBody)"/>
      {/* 메가폰 입구 (큰 종) */}
      <ellipse cx="160" cy="95" rx="55" ry="50" fill="url(#mgBell)"/>
      <ellipse cx="160" cy="95" rx="55" ry="50" fill="none" stroke="#3B72E8" strokeWidth="3"/>
      {/* 메가폰 입구 안쪽 */}
      <ellipse cx="165" cy="95" rx="32" ry="28" fill="#5A8EF5"/>
      <ellipse cx="170" cy="92" rx="22" ry="18" fill="#3B72E8"/>
      {/* 본체 → 종 연결부 */}
      <path d="M120 75 L120 115 L160 110 L160 80 Z" fill="url(#mgBody)"/>
      {/* 노란색 트리거 */}
      <circle cx="70" cy="78" r="10" fill="url(#mgYellow)"/>
      <rect x="60" y="65" width="8" height="8" rx="2" fill="url(#mgYellow)"/>
      {/* 손잡이 */}
      <path d="M85 115 L85 145 Q85 155 95 155 L105 155 Q115 155 115 145 L115 115 Z" fill="url(#mgHandle)"/>
      {/* 입구 하이라이트 */}
      <ellipse cx="140" cy="80" rx="10" ry="5" fill="#fff" opacity="0.6"/>
      {/* 작은 장식 점들 */}
      <circle cx="225" cy="65" r="4" fill="#3B72E8" opacity="0.5"/>
      <circle cx="218" cy="50" r="3" fill="#7BA5F2" opacity="0.5"/>
    </svg>
  );
}
function MegaphoneSmall() {
  return (
    <svg width="100" height="80" viewBox="0 0 240 180">
      <path d="M75 75 Q70 75 70 80 L70 110 Q70 115 75 115 L120 110 L120 80 Z" fill="#fff" opacity="0.7"/>
      <ellipse cx="160" cy="95" rx="55" ry="50" fill="#fff" opacity="0.9"/>
      <ellipse cx="165" cy="95" rx="32" ry="28" fill="#3B72E8" opacity="0.5"/>
      <circle cx="70" cy="78" r="10" fill="#FBBF24"/>
      <path d="M85 115 L85 145 Q85 155 95 155 L105 155 Q115 155 115 145 L115 115 Z" fill="#fff" opacity="0.7"/>
    </svg>
  );
}
function SirenSmall() {
  return (
    <svg width="70" height="70" viewBox="0 0 70 70">
      <defs>
        <linearGradient id="srn" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#FF8080"/><stop offset="100%" stopColor="#E04848"/></linearGradient>
      </defs>
      <ellipse cx="35" cy="60" rx="22" ry="4" fill="#1A2340" opacity="0.15"/>
      <rect x="14" y="46" width="42" height="10" rx="3" fill="#5A6680"/>
      <path d="M18 46 L22 22 Q22 14 35 14 Q48 14 48 22 L52 46 Z" fill="url(#srn)"/>
      <ellipse cx="35" cy="20" rx="10" ry="4" fill="#FF9F9F"/>
      <circle cx="35" cy="10" r="3" fill="#FBBF24"/>
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32">
      <defs><linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#7BA5F2"/><stop offset="100%" stopColor="#3B72E8"/></linearGradient></defs>
      <rect x="6" y="6" width="20" height="22" rx="3" fill="url(#cbg)"/>
      <rect x="10" y="3" width="12" height="5" rx="1.5" fill="#5A6680"/>
      <line x1="11" y1="14" x2="21" y2="14" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
      <line x1="11" y1="18" x2="21" y2="18" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
      <line x1="11" y1="22" x2="17" y2="22" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32">
      <defs><linearGradient id="ug" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#7BA5F2"/><stop offset="100%" stopColor="#3B72E8"/></linearGradient></defs>
      <circle cx="12" cy="11" r="5" fill="url(#ug)"/>
      <path d="M3 27c0-5 4-8 9-8s9 3 9 8" fill="url(#ug)"/>
      <circle cx="22" cy="13" r="4" fill="#A8C4F8"/>
      <path d="M18 27c0-3.5 2-6 6-6s5 2 5 5" fill="#A8C4F8"/>
    </svg>
  );
}
function IconSiren() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32">
      <defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#FF8080"/><stop offset="100%" stopColor="#E04848"/></linearGradient></defs>
      <rect x="6" y="22" width="20" height="5" rx="1.5" fill="#5A6680"/>
      <path d="M9 22 L11 12 Q11 6 16 6 Q21 6 21 12 L23 22 Z" fill="url(#sg)"/>
      <ellipse cx="16" cy="10" rx="5" ry="2" fill="#FFB8B8"/>
      <circle cx="16" cy="4" r="2" fill="#FBBF24"/>
    </svg>
  );
}
function IconCheckCircle() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32">
      <defs><linearGradient id="ccg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#3DC489"/><stop offset="100%" stopColor="#10A26A"/></linearGradient></defs>
      <circle cx="16" cy="16" r="12" fill="url(#ccg)"/>
      <polyline points="10 16 14 20 22 12" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function NavHome() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12l9-9 9 9M5 10v10h14V10"/></svg>; }
function NavCheck() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>; }
function NavTrophy() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M5 5H3v3a4 4 0 0 0 4 4"/><path d="M19 5h2v3a4 4 0 0 1-4 4"/></svg>; }
function NavList() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>; }
function NavUser() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"/></svg>; }
function NavWarn() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1"/></svg>; }

export { MemberApp, AdminApp };
