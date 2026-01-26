/* TaskPad - vanilla JS, localStorage */
(() => {
  const STORAGE_KEY = "taskpad.v1";
  const SETTINGS_KEY = "taskpad.settings.v1";
  const $ = (sel) => document.querySelector(sel);

  const ui = {
    list: $("#list"),
    detail: $("#detail"),
    alerts: $("#alerts"),
    search: $("#searchInput"),
    newBtn: $("#newBtn"),
    badgeToday: $("#badgeToday"),
    badgeWeek: $("#badgeWeek"),
    badgeNoDate: $("#badgeNoDate"),
    sheet: $("#sheet"),
    sheetBackdrop: $("#sheetBackdrop"),
    sheetContent: $("#sheetContent"),
    plusTab: $("#plusTab"),
    categoryFilter: $("#categoryFilter"),
  };

  const state = {
    view: "today",
    query: "",
    tasks: [],
    selectedId: null,
    weekMode: "sunday", // "sunday" or "7days"
    categories: ["その他","趣味","作業"],
    filterCategory: "all",
    weekCollapsed: {},
  };

  function pad2(n){ return String(n).padStart(2,"0"); }
  function toYmd(d){
    const y = d.getFullYear();
    const m = pad2(d.getMonth()+1);
    const da = pad2(d.getDate());
    return `${y}-${m}-${da}`;
  }
  function parseYmd(s){
    if(!s) return null;
    const [y,m,d] = s.split("-").map(Number);
    if(!y || !m || !d) return null;
    return new Date(y, m-1, d, 12, 0, 0);
  }
  function startOfToday(){
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0);
  }
  function endOfWeekInclusive(){
    const t = startOfToday();
    const end = new Date(t);

    if(state.weekMode === "7days"){
      // Today + 6 days (7-day window)
      end.setDate(end.getDate() + 6);
      return end;
    }

    // Default: until Sunday
    const day = t.getDay(); // 0:Sun
    const add = (7 - day) % 7;
    end.setDate(end.getDate() + add);
    return end;
  }
  function isSameYmd(a, b){
    return a && b && toYmd(a) === toYmd(b);
  }

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return;
      const data = JSON.parse(raw);
      if(Array.isArray(data.tasks)) state.tasks = data.tasks;
    }catch(e){
      console.warn("Failed to load", e);
    }
  }
  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: state.tasks }));
  }

  function loadSettings(){
    try{
      const raw = localStorage.getItem(SETTINGS_KEY);
      if(!raw) return;
      const data = JSON.parse(raw);

      if(data && (data.weekMode === "sunday" || data.weekMode === "7days")){
        state.weekMode = data.weekMode;
      }
      if(Array.isArray(data.categories) && data.categories.length){
        const cleaned = data.categories
          .map(x => String(x||"").trim())
          .filter(Boolean)
          .slice(0, 30);
        state.categories = [...new Set(cleaned)];
      }
      if(typeof data.filterCategory === "string"){
        state.filterCategory = data.filterCategory;
      }
      if(data && typeof data.weekCollapsed === "object" && data.weekCollapsed){
        state.weekCollapsed = data.weekCollapsed;
      }
    }catch(e){
      console.warn("Failed to load settings", e);
    }
  }
  function saveSettings(){
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      weekMode: state.weekMode,
      categories: state.categories,
      filterCategory: state.filterCategory,
      weekCollapsed: state.weekCollapsed,
    }));
  }


  function uid(){
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  }

  function nowIso(){
    return new Date().toISOString();
  }

  function normalizeTask(t){
    return {
      id: t.id || uid(),
      title: t.title || "",
      dueDate: t.dueDate || "", // YYYY-MM-DD or ""
      priority: t.priority || "mid", // low/mid/high
      status: t.status || "todo", // todo/doing/done
      category: t.category || "", // optional
      memo: t.memo || "",
      createdAt: t.createdAt || nowIso(),
    };
  }

  function addTask(partial){
    const t = normalizeTask(partial);
    // Inbox扱い：カテゴリ未設定なら "INBOX" と見なす（表示上だけ）
    state.tasks.unshift(t);
    state.selectedId = t.id;
    save();
    render();
    openDetailIfMobile();
  }

  function updateTask(id, patch){
    const i = state.tasks.findIndex(x => x.id === id);
    if(i < 0) return;
    state.tasks[i] = { ...state.tasks[i], ...patch };
    save();
    render();
  }

  function deleteTask(id){
    const i = state.tasks.findIndex(x => x.id === id);
    if(i < 0) return;
    state.tasks.splice(i,1);
    if(state.selectedId === id) state.selectedId = null;
    save();
    render();
  }

  function allCategoriesForFilter(){
    // union: presets + categories actually used in tasks
    const used = state.tasks
      .map(t => String((t.category || "")).trim())
      .filter(Boolean);
    const merged = [...state.categories, ...used];
    const uniq = [];
    for(const c of merged){
      const s = String(c||"").trim();
      if(!s || s === "INBOX") continue;
      if(!uniq.includes(s)) uniq.push(s);
    }
    return uniq.slice(0, 60);
  }

  function filteredTasks(){
    const q = (state.query || "").trim().toLowerCase();
    const fcat = state.filterCategory || "all";

    return state.tasks.filter(t => {
      const cat = (t.category || "").trim() || "INBOX";
      if(fcat !== "all" && cat !== fcat) return false;

      if(!q) return true;
      const hay = `${t.title} ${t.memo}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function classify(t){
    const today = startOfToday();
    const endWeek = endOfWeekInclusive();
    const due = parseYmd(t.dueDate);
    const done = t.status === "done";
    if(done) return "done";
    if(!due) return "nodate";
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 0,0,0);
    if(dueDay < today) return "overdue";
    if(isSameYmd(dueDay, today)) return "today";
    if(dueDay <= endWeek) return "week";
    return "later";
  }

  function groupWeek(tasks){
    const m = new Map();
    tasks.forEach(t => {
      const due = parseYmd(t.dueDate);
      const key = due ? toYmd(due) : "";
      if(!m.has(key)) m.set(key, []);
      m.get(key).push(t);
    });
    const keys = [...m.keys()].sort();
    return keys.map(k => ({ date: k, items: m.get(k) }));
  }

  function priorityLabel(p){
    if(p === "high") return "高";
    if(p === "low") return "低";
    return "中";
  }

  function ymdToLabel(ymd){
    const d = parseYmd(ymd);
    if(!d) return "";
    const w = ["日","月","火","水","木","金","土"][d.getDay()];
    return `${d.getMonth()+1}/${d.getDate()}(${w})`;
  }

  function render(){
    const tasks = filteredTasks();

    const buckets = {
      overdue: [],
      today: [],
      week: [],
      later: [],
      nodate: [],
      done: [],
      inbox: [],
    };

    for(const t of tasks){
      const c = classify(t);
      if((t.category || "").trim() === "") buckets.inbox.push(t);
      buckets[c].push(t);
    }

    // Badges
    ui.badgeToday.textContent = String(buckets.overdue.length + buckets.today.length);
    ui.badgeWeek.textContent = String(buckets.week.length);
    ui.badgeNoDate.textContent = String(buckets.nodate.length);

    // Category filter (desktop)
    if(ui.categoryFilter){
      const cur = state.filterCategory || "all";
      ui.categoryFilter.innerHTML = "";

      const optAll = document.createElement("option");
      optAll.value = "all";
      optAll.textContent = "カテゴリ: 全部";
      ui.categoryFilter.appendChild(optAll);

      const optInbox = document.createElement("option");
      optInbox.value = "INBOX";
      optInbox.textContent = "INBOX（未分類）";
      ui.categoryFilter.appendChild(optInbox);

      allCategoriesForFilter().forEach(c => {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = c;
        ui.categoryFilter.appendChild(o);
      });

      if(cur !== "all" && cur !== "INBOX" && ![...ui.categoryFilter.options].some(o => o.value === cur)){
        const o = document.createElement("option");
        o.value = cur;
        o.textContent = cur;
        ui.categoryFilter.appendChild(o);
      }

      ui.categoryFilter.value = cur;
    }

    // Active buttons
    document.querySelectorAll("[data-view]").forEach(btn => {
      const v = btn.getAttribute("data-view");
      btn.classList.toggle("is-active", v === state.view);
    });

    // Alerts
    ui.alerts.innerHTML = "";
    const alertRow = document.createElement("div");
    alertRow.className = "alertrow";

    const overduePill = pill(`期限切れ`, buckets.overdue.length, "pill--danger", () => scrollToSection("sec-overdue"));
    const todayPill = pill(`今日が期日`, buckets.today.length, "pill--amber", () => scrollToSection("sec-today"));
    alertRow.appendChild(overduePill);
    alertRow.appendChild(todayPill);

    const meta = document.createElement("div");
    meta.style.marginTop = "10px";
    meta.style.color = "var(--muted)";
    meta.style.fontSize = "12px";
    meta.textContent = `今日: ${ymdToLabel(toYmd(new Date()))} / 今週末: ${ymdToLabel(toYmd(endOfWeekInclusive()))}`;
    ui.alerts.appendChild(alertRow);
    ui.alerts.appendChild(meta);

    // List by view
    ui.list.innerHTML = "";
    if(state.view === "today"){
      renderSection("期限切れ", buckets.overdue, { id:"sec-overdue", tone:"danger" });
      renderSection("今日が期日", buckets.today, { id:"sec-today", tone:"amber" });
      renderSection("期限なし（参考）", buckets.nodate.slice(0, 5), { meta:"上位5件だけ表示" });
    }else if(state.view === "week"){
      const groups = groupWeek(buckets.week);
      if(groups.length === 0){
        ui.list.appendChild(emptyBlock("今週のタスクはありません"));
      }else{
        groups.forEach(g => {
          const key = g.date;
          const collapsed = !!state.weekCollapsed[key];
          renderSection(ymdToLabel(g.date), g.items, { meta: `${g.items.length}件`, collapsible:true, collapsed, key });
        });
      }
    }else if(state.view === "nodate"){
      renderSection("期限なし", buckets.nodate, { meta:`${buckets.nodate.length}件` });
      if(buckets.nodate.length){
        ui.list.appendChild(infoBlock("ここから「今日にする」「明日にする」で期日を付けると運用が楽です。"));
      }
    }else if(state.view === "settings"){
      renderSettingsView(buckets);
    }

    // Detail (desktop)
    renderDetailDesktop();

    // If selected task is filtered out, reset
    if(state.selectedId && !state.tasks.some(t => t.id === state.selectedId)){
      state.selectedId = null;
      renderDetailDesktop();
    }
  }

  function pill(label, count, cls, onClick){
    const el = document.createElement("button");
    el.className = `pill ${cls || ""}`;
    el.type = "button";
    el.innerHTML = `<span>${escapeHtml(label)}</span><span class="pill__count">${count}</span>`;
    el.addEventListener("click", onClick);
    return el;
  }

  function renderSection(title, items, opts = {}){
    const sec = document.createElement("div");
    sec.className = "section";
    if(opts.id) sec.id = opts.id;

    const head = document.createElement("div");
    head.className = "section__head";

    const left = document.createElement("div");
    left.className = "section__title";
    left.textContent = title;

    const right = document.createElement("div");
    right.className = "section__meta";
    right.textContent = opts.meta || (items.length ? `${items.length}件` : "");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "smallbtn smallbtn--icon";
    toggle.style.marginLeft = "8px";
    toggle.textContent = opts.collapsible ? (opts.collapsed ? "＋" : "－") : "";
    toggle.title = opts.collapsible ? "折りたたみ" : "";
    toggle.style.display = opts.collapsible ? "inline-flex" : "none";

    head.appendChild(left);
    const rightWrap = document.createElement("div");
    rightWrap.style.display = "flex";
    rightWrap.style.alignItems = "center";
    rightWrap.appendChild(right);
    rightWrap.appendChild(toggle);
    head.appendChild(rightWrap);

    if(opts.collapsible){
      head.style.cursor = "pointer";
      head.addEventListener("click", () => {
        const key = opts.key || title;
        state.weekCollapsed[key] = !state.weekCollapsed[key];
        saveSettings();
        render();
      });
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = opts.key || title;
        state.weekCollapsed[key] = !state.weekCollapsed[key];
        saveSettings();
        render();
      });
    }

    sec.appendChild(head);

    if(opts.collapsible && opts.collapsed){
      sec.appendChild(emptyBlock("（折りたたみ中）"));
      ui.list.appendChild(sec);
      return;
    }

    if(items.length === 0){
      sec.appendChild(emptyBlock("なし"));
    }else{
      items.forEach(t => sec.appendChild(taskRow(t, opts.tone)));
    }
    ui.list.appendChild(sec);
  }

  function infoBlock(text){
    const d = document.createElement("div");
    d.style.margin = "12px 0";
    d.style.padding = "10px 12px";
    d.style.border = "1px solid var(--line)";
    d.style.borderRadius = "12px";
    d.style.background = "rgba(255,255,255,.04)";
    d.style.color = "var(--muted)";
    d.style.fontSize = "12px";
    d.textContent = text;
    return d;
  }

  function emptyBlock(text){
    const d = document.createElement("div");
    d.style.padding = "10px 12px";
    d.style.color = "var(--muted)";
    d.style.fontSize = "12px";
    d.textContent = text;
    return d;
  }

  function taskRow(t, tone){
    const row = document.createElement("div");
    row.className = "item" + (t.status === "done" ? " is-done" : "");
    row.addEventListener("click", (e) => {
      // Avoid click from buttons
      if(e.target && e.target.closest("button")) return;
      state.selectedId = t.id;
      render();
      openDetailIfMobile();
    });

    const c = classify(t);
    const chk = document.createElement("div");
    chk.className = "chk" + (t.status === "done" ? " is-on" : "");
    chk.title = "完了";
    chk.addEventListener("click", (e) => {
      e.stopPropagation();
      updateTask(t.id, { status: (t.status === "done" ? "todo" : "done") });
    });

    const sub = [];
    const due = t.dueDate ? `期日:${t.dueDate}` : "期日なし";
    sub.push(`<span class="tag">${escapeHtml(due)}</span>`);
    const pr = `<span class="tag">${escapeHtml("優先:" + priorityLabel(t.priority))}</span>`;
    sub.push(pr);

    const cat = (t.category || "").trim() ? `<span class="tag">${escapeHtml(t.category)}</span>` : `<span class="tag">INBOX</span>`;
    sub.push(cat);
    if(c === "overdue") sub.push(`<span class="tag tag--danger">期限切れ</span>`);
    if(c === "today") sub.push(`<span class="tag tag--amber">今日</span>`);

    const right = document.createElement("div");
    right.className = "item__right";

    const quickToday = document.createElement("button");
    quickToday.className = "smallbtn";
    quickToday.type = "button";
    quickToday.textContent = "今日";
    quickToday.title = "期日を今日にする";
    quickToday.addEventListener("click", (e) => {
      e.stopPropagation();
      updateTask(t.id, { dueDate: toYmd(new Date()) });
    });

    const quickTomorrow = document.createElement("button");
    quickTomorrow.className = "smallbtn";
    quickTomorrow.type = "button";
    quickTomorrow.textContent = "明日";
    quickTomorrow.title = "期日を明日にする";
    quickTomorrow.addEventListener("click", (e) => {
      e.stopPropagation();
      const d = startOfToday(); d.setDate(d.getDate()+1);
      updateTask(t.id, { dueDate: toYmd(d) });
    });

    const quickNoDate = document.createElement("button");
    quickNoDate.className = "smallbtn";
    quickNoDate.type = "button";
    quickNoDate.textContent = "なし";
    quickNoDate.title = "期日を外す";
    quickNoDate.addEventListener("click", (e) => {
      e.stopPropagation();
      updateTask(t.id, { dueDate: "" });
    });

    // show quick buttons only where it makes sense
    if(state.view === "nodate" || state.view === "settings") right.appendChild(quickToday);
    if(state.view === "nodate" || state.view === "settings") right.appendChild(quickTomorrow);
    if(state.view !== "nodate") right.appendChild(quickNoDate);

    row.innerHTML = `
      <div></div>
      <div>
        <div class="item__title">${escapeHtml(t.title || "(無題)")}</div>
        <div class="item__sub">${sub.join("")}</div>
      </div>
    `;
    row.children[0].appendChild(chk);
    row.appendChild(right);
    return row;
  }

  function renderDetailDesktop(){
    const el = ui.detail;
    const t = state.tasks.find(x => x.id === state.selectedId);
    if(!t){
      el.innerHTML = `<div class="detail__empty">タスクを選ぶと、ここで編集できます。</div>`;
      return;
    }
    el.innerHTML = detailFormHtml(t);
    wireDetailForm(el, t, { isSheet:false });
  }

  function openDetailIfMobile(){
    if(window.matchMedia("(max-width: 1020px)").matches){
      // use sheet on <= 1020? actually only on mobile (<=760) for better UX
      if(window.matchMedia("(max-width: 760px)").matches){
        openSheetForSelected();
      }
    }
  }

  function openSheetForSelected(){
    const t = state.tasks.find(x => x.id === state.selectedId);
    if(!t) return;
    ui.sheetContent.innerHTML = detailFormHtml(t, true);
    wireDetailForm(ui.sheetContent, t, { isSheet:true });
    ui.sheet.hidden = false;
  }

  function closeSheet(){
    ui.sheet.hidden = true;
  }

  function detailFormHtml(t, compact=false){
    const cat = (t.category || "").trim();
    return `
      <div class="detail__head">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-weight:900;font-size:${compact ? "16px":"18px"};">編集</div>
          ${compact ? `<button class="btn btn--ghost" type="button" data-action="closeSheet">閉じる</button>` : ""}
        </div>
      </div>

      <div class="field">
        <div class="label">タイトル</div>
        <input class="input" data-k="title" value="${escapeAttr(t.title)}" placeholder="タスク名" />
      </div>

      <div class="row">
        <div class="field">
          <div class="label">期日（予定日）</div>
          <input class="input" data-k="dueDate" type="date" value="${escapeAttr(t.dueDate)}" />
        </div>
        <div class="field">
          <div class="label">優先度</div>
          <select class="select" data-k="priority">
            <option value="high" ${t.priority==="high"?"selected":""}>高</option>
            <option value="mid" ${t.priority==="mid"?"selected":""}>中</option>
            <option value="low" ${t.priority==="low"?"selected":""}>低</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div class="field">
          <div class="label">状態</div>
          <select class="select" data-k="status">
            <option value="todo" ${t.status==="todo"?"selected":""}>ToDo</option>
            <option value="doing" ${t.status==="doing"?"selected":""}>Doing</option>
            <option value="done" ${t.status==="done"?"selected":""}>Done</option>
          </select>
        </div>
        <div class="field">
          <div class="label">カテゴリ（空ならINBOX）</div>
          <input class="input" data-k="category" value="${escapeAttr(cat)}" list="categoryList" placeholder="例：DQ / 小説 / 日常" />
          <datalist id="categoryList">
            <option value="INBOX"></option>
            ${state.categories.map(c => `<option value="${escapeHtml(c)}"></option>`).join("")}
          </datalist>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
            ${state.categories.map(c => `<button class="smallbtn" type="button" data-catpick="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}
            <button class="smallbtn" type="button" data-catpick="">INBOX</button>
          </div>
        </div>
      </div>

      <div class="field">
        <div class="label">作成日</div>
        <input class="input" value="${escapeAttr((t.createdAt||"").slice(0,10))}" disabled />
      </div>

      <div class="field">
        <div class="label">メモ</div>
        <textarea class="textarea" data-k="memo" placeholder="補足">${escapeHtml(t.memo || "")}</textarea>
      </div>

      <div class="actions">
        <button class="btn btn--primary" type="button" data-action="today">今日にする</button>
        <button class="btn" type="button" data-action="tomorrow">明日にする</button>
        <button class="btn" type="button" data-action="clearDue">期限なしへ</button>
        <button class="btn" type="button" data-action="toggleDone">${t.status==="done" ? "未完了に戻す" : "完了にする"}</button>
      </div>

      <div class="sep"></div>

      <div class="actions">
        <button class="btn btn--danger" type="button" data-action="delete">削除</button>
      </div>
    `;
  }

  function wireDetailForm(root, t, {isSheet}){
    root.querySelectorAll("[data-k]").forEach(inp => {
      inp.addEventListener("input", () => {
        const k = inp.getAttribute("data-k");
        let v = inp.value;
        updateTask(t.id, { [k]: v });
      });
      inp.addEventListener("change", () => {
        const k = inp.getAttribute("data-k");
        let v = inp.value;
        updateTask(t.id, { [k]: v });
      });
    });

    root.querySelectorAll("[data-catpick]").forEach(b => {
      b.addEventListener("click", () => {
        updateTask(t.id, { category: b.getAttribute("data-catpick") || "" });
      });
    });

    root.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-action");
        if(act === "today"){
          updateTask(t.id, { dueDate: toYmd(new Date()) });
        }else if(act === "tomorrow"){
          const d = startOfToday(); d.setDate(d.getDate()+1);
          updateTask(t.id, { dueDate: toYmd(d) });
        }else if(act === "clearDue"){
          updateTask(t.id, { dueDate: "" });
        }else if(act === "toggleDone"){
          updateTask(t.id, { status: (t.status === "done" ? "todo" : "done") });
        }else if(act === "delete"){
          if(confirm("削除しますか？")) deleteTask(t.id);
          if(isSheet) closeSheet();
        }else if(act === "closeSheet"){
          closeSheet();
        }
      });
    });
  }

  function renderSettingsView(buckets){
    const wrap = document.createElement("div");

    const h = document.createElement("div");
    h.className = "section";
    h.innerHTML = `
      <div class="section__head">
        <div class="section__title">設定</div>
        <div class="section__meta"></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0;">
        <button class="btn btn--primary" type="button" id="btnExportAll">TSVコピー</button>
        <button class="btn" type="button" id="btnBackup">バックアップ(JSON)をコピー</button>
      </div>
      <div style="color:var(--muted);font-size:12px;">
        ※データはこの端末のブラウザ内（localStorage）に保存されます。
      </div>
    `;
    wrap.appendChild(h);


    // Week mode setting
    const weekSec = document.createElement("div");
    weekSec.className = "section";
    weekSec.innerHTML = `
      <div class="section__head">
        <div class="section__title">今週の範囲</div>
        <div class="section__meta"></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0;">
        <label class="radio">
          <input type="radio" name="weekMode" value="sunday" ${state.weekMode==="sunday"?"checked":""} />
          日曜まで
        </label>
        <label class="radio">
          <input type="radio" name="weekMode" value="7days" ${state.weekMode==="7days"?"checked":""} />
          7日先まで
        </label>
      </div>
      <div style="color:var(--muted);font-size:12px;">
        ※「今週」タブの表示範囲が変わります。
      </div>
    `;
    wrap.appendChild(weekSec);

    // Category presets
    const catSec = document.createElement("div");
    catSec.className = "section";
    catSec.innerHTML = `
      <div class="section__head">
        <div class="section__title">カテゴリ（プリセット）</div>
        <div class="section__meta">${state.categories.length}件</div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0;">
        <input class="input" id="catNew" placeholder="カテゴリ名を追加（例：DQ）" style="max-width:320px;" />
        <button class="btn btn--primary" type="button" id="catAdd">追加</button>
        <button class="btn" type="button" id="catReset">初期に戻す</button>
      </div>

      <div id="catList" style="display:flex;flex-wrap:wrap;gap:8px;"></div>

      <div style="margin-top:12px;">
        <div class="label">カテゴリで絞り込み（全画面共通）</div>
        <select class="select" id="catFilterSelect"></select>
      </div>

      <div style="color:var(--muted);font-size:12px;margin-top:8px;">
        ※ここで設定したカテゴリはローカル保存され、編集画面のワンタップ入力やフィルターに使われます。
      </div>
    `;
    wrap.appendChild(catSec);

    // Inbox
    const inbox = document.createElement("div");
    inbox.className = "section";
    inbox.innerHTML = `
      <div class="section__head">
        <div class="section__title">Inbox（カテゴリ未設定）</div>
        <div class="section__meta">${buckets.inbox.length}件</div>
      </div>
    `;
    if(buckets.inbox.length === 0){
      inbox.appendChild(emptyBlock("なし"));
    }else{
      buckets.inbox.slice(0, 30).forEach(t => inbox.appendChild(taskRow(t)));
      if(buckets.inbox.length > 30) inbox.appendChild(infoBlock("※表示は上位30件まで"));
    }
    wrap.appendChild(inbox);

    // Done
    const done = document.createElement("div");
    done.className = "section";
    done.innerHTML = `
      <div class="section__head">
        <div class="section__title">完了</div>
        <div class="section__meta">${buckets.done.length}件</div>
      </div>
    `;
    if(buckets.done.length === 0){
      done.appendChild(emptyBlock("なし"));
    }else{
      buckets.done.slice(0, 40).forEach(t => done.appendChild(taskRow(t)));
      if(buckets.done.length > 40) done.appendChild(infoBlock("※表示は上位40件まで"));
    }
    wrap.appendChild(done);

    // Danger zone
    const dz = document.createElement("div");
    dz.className = "section";
    dz.innerHTML = `
      <div class="section__head">
        <div class="section__title">データ削除</div>
        <div class="section__meta"></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn--danger" type="button" id="btnClearAll">全タスクを削除</button>
      </div>
    `;
    wrap.appendChild(dz);

    ui.list.appendChild(wrap);

    // Wire buttons
        $("#btnExportAll").addEventListener("click", () => {
      const rows = state.tasks;
      copyText(toTsv(rows));
      alert("TSVをコピーしました。スプレッドシート等に貼り付けできます。");
    });
    $("#btnBackup").addEventListener("click", () => {
      copyText(JSON.stringify({ tasks: state.tasks }, null, 2));
      alert("バックアップ(JSON)をコピーしました。");
    });

    // Week mode radios
    wrap.querySelectorAll('input[name="weekMode"]').forEach(r => {
      r.addEventListener("change", () => {
        const v = r.value;
        if(v === "sunday" || v === "7days"){
          state.weekMode = v;
          saveSettings();
          render();
        }
      });
    });
    
    // Category presets UI
    const catList = wrap.querySelector("#catList");
    const renderCatChips = () => {
      if(!catList) return;
      catList.innerHTML = "";
      state.categories.forEach((c, idx) => {
        const chip = document.createElement("div");
        chip.className = "chip";
        chip.innerHTML = `<span>${escapeHtml(c)}</span><button type="button" aria-label="remove">×</button>`;
        chip.querySelector("button").addEventListener("click", () => {
          state.categories.splice(idx, 1);
          if(state.filterCategory === c) state.filterCategory = "all";
          saveSettings();
          render();
        });
        catList.appendChild(chip);
      });
      if(state.categories.length === 0){
        catList.appendChild(emptyBlock("（なし）"));
      }
    };

    const catNew = wrap.querySelector("#catNew");
    const catAdd = wrap.querySelector("#catAdd");
    const catReset = wrap.querySelector("#catReset");

    if(catAdd && catNew){
      catAdd.addEventListener("click", () => {
        const v = (catNew.value || "").trim();
        if(!v) return;
        if(v === "INBOX"){ alert("INBOX は予約語なので使えません"); return; }
        if(state.categories.includes(v)){ catNew.value=""; return; }
        state.categories.unshift(v);
        state.categories = state.categories.slice(0, 30);
        catNew.value = "";
        saveSettings();
        render();
      });
      catNew.addEventListener("keydown", (e) => {
        if(e.key === "Enter"){ e.preventDefault(); catAdd.click(); }
      });
    }

    if(catReset){
      catReset.addEventListener("click", () => {
        state.categories = ["その他","趣味","作業"];
        state.filterCategory = "all";
        saveSettings();
        render();
      });
    }

    // Filter select (mobile-friendly)
    const catFilterSelect = wrap.querySelector("#catFilterSelect");
    if(catFilterSelect){
      const rebuild = () => {
        const cur = state.filterCategory || "all";
        catFilterSelect.innerHTML = "";

        const oAll = document.createElement("option"); oAll.value="all"; oAll.textContent="全部";
        const oIn = document.createElement("option"); oIn.value="INBOX"; oIn.textContent="INBOX（未分類）";
        catFilterSelect.appendChild(oAll);
        catFilterSelect.appendChild(oIn);

        allCategoriesForFilter().forEach(c => {
          const o = document.createElement("option"); o.value=c; o.textContent=c;
          catFilterSelect.appendChild(o);
        });

        if(cur !== "all" && cur !== "INBOX" && ![...catFilterSelect.options].some(o => o.value === cur)){
          const o = document.createElement("option"); o.value=cur; o.textContent=cur;
          catFilterSelect.appendChild(o);
        }

        catFilterSelect.value = cur;
      };
      rebuild();
      catFilterSelect.addEventListener("change", () => {
        state.filterCategory = catFilterSelect.value || "all";
        saveSettings();
        render();
      });
    }

    renderCatChips();

$("#btnClearAll").addEventListener("click", () => {
      if(confirm("本当に全タスクを削除しますか？")){
        state.tasks = [];
        state.selectedId = null;
        save();
        render();
      }
    });
  }

  function toTsv(rows){
    // Columns tuned for spreadsheets
    const header = ["title","dueDate","priority","status","category","exported","memo","createdAt","id"].join("\t");
    const lines = rows.map(t => [
      cleanTsv(t.title),
      cleanTsv(t.dueDate),
      cleanTsv(t.priority),
      cleanTsv(t.status),
      cleanTsv(t.category || "INBOX"),
      cleanTsv(t.memo),
      cleanTsv(t.createdAt),
      cleanTsv(t.id),
    ].join("\t"));
    return [header, ...lines].join("\n");
  }
  function cleanTsv(s){
    return String(s ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
  }

  async function copyText(text){
    try{
      await navigator.clipboard.writeText(text);
    }catch(e){
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  function scrollToSection(id){
    const el = document.getElementById(id);
    if(!el) return;
    el.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  function escapeHtml(str){
    return String(str ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
  function escapeAttr(str){
    return escapeHtml(str).replaceAll("\n"," ");
  }

  function setView(v){
    state.view = v;
    render();
    closeSheet();
  }

  function bindNav(){
    document.querySelectorAll("[data-view]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.getAttribute("data-view");
        if(v) setView(v);
      });
    });
  }

  function bindTopbar(){
    ui.search.addEventListener("input", () => {
      state.query = ui.search.value;
      render();
    });

    if(ui.categoryFilter){
      ui.categoryFilter.addEventListener("change", () => {
        state.filterCategory = ui.categoryFilter.value || "all";
        saveSettings();
        render();
      });
    }

    ui.newBtn.addEventListener("click", () => openQuickAdd());
    ui.plusTab.addEventListener("click", () => openQuickAdd());
  }

  function openQuickAdd(){
    // Create minimal task via prompt-like sheet on mobile; desktop uses selection + detail
    if(window.matchMedia("(max-width: 760px)").matches){
      ui.sheetContent.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-weight:900;font-size:16px;">追加</div>
          <button class="btn btn--ghost" type="button" data-action="closeSheet">閉じる</button>
        </div>

        <div class="field" style="margin-top:10px;">
          <div class="label">期日プリセット</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button class="smallbtn" type="button" data-qadue="today">今日</button>
            <button class="smallbtn" type="button" data-qadue="tomorrow">明日</button>
            <button class="smallbtn" type="button" data-qadue="nodate">なし</button>
          </div>
          <div style="color:var(--muted);font-size:12px;margin-top:6px;">
            ※未選択のままでもOK（タイトルだけ保存できます）
          </div>
        </div>

        <div class="field" style="margin-top:10px;">
          <div class="label">タイトル（これだけで保存OK）</div>
          <input class="input" id="qaTitle" placeholder="例：CSV更新 / 記事メモ / 返信" />
        </div>

        <div class="actions">
          <button class="btn btn--primary" type="button" id="qaSave">保存</button>
        </div>

        <div style="color:var(--muted);font-size:12px;margin-top:8px;">
          保存後に編集画面で期日・カテゴリ等を追加できます。
        </div>
      `;
      ui.sheet.hidden = false;
      ui.sheetContent.querySelector("[data-action='closeSheet']").addEventListener("click", closeSheet);
      const input = $("#qaTitle");
      input.focus();

      let preset = ""; // "" | "today" | "tomorrow" | "nodate"
      ui.sheetContent.querySelectorAll("[data-qadue]").forEach(btn => {
        btn.addEventListener("click", () => {
          preset = btn.getAttribute("data-qadue") || "";
          // visual active
          ui.sheetContent.querySelectorAll("[data-qadue]").forEach(b => b.style.outline = "");
          btn.style.outline = "2px solid rgba(37,99,235,.35)";
        });
      });

      $("#qaSave").addEventListener("click", () => {
        const title = (input.value || "").trim();
        if(!title){ alert("タイトルを入力してください"); return; }

        let dueDate = "";
        if(preset === "today"){
          dueDate = toYmd(new Date());
        }else if(preset === "tomorrow"){
          const d = startOfToday(); d.setDate(d.getDate()+1);
          dueDate = toYmd(d);
        }else if(preset === "nodate"){
          dueDate = "";
        }
        addTask({ title, dueDate });
        // detail opens automatically
      });
      return;
    }

    // Desktop: add + select and show in detail panel
    const title = prompt("タスク名（空でキャンセル）");
    if(!title) return;
    addTask({ title: title.trim() });
  }

  function init(){
    load();
    loadSettings();
    if(state.tasks.length === 0){
      // Seed minimal sample (optional) - keep it tiny
      state.tasks = [
        normalizeTask({ title: "TaskPadへようこそ（タップして編集）", dueDate: "", priority:"mid", category:"", memo:"期日は予定日＝締切として扱います。" }),
        normalizeTask({ title: "今日が期日のタスク例", dueDate: toYmd(new Date()), priority:"high", category:"", memo:"期限切れ/今日が期日は上に出ます。" }),
      ];
      save();
    }

    bindNav();
    bindTopbar();

    ui.sheetBackdrop.addEventListener("click", closeSheet);
    window.addEventListener("keydown", (e) => {
      if(e.key === "Escape") closeSheet();
    });

    render();
  }

  init();
})();
