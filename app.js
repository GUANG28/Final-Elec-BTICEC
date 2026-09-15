/**
 * Betong EduExam Online Platform - Core Application Logic
 * แผนกวิชาช่างอิเล็กทรอนิกส์ วิทยาลัยการอาชีพเบตง
 * ผู้สอน: นายณัฐชา ไชยหมาน
 */

class ExamEngine {
  constructor() {
    this.data = window.EXAM_DATA || {};
    this.state = {
      courseId: '',
      student: { id: '', name: '', level: '', room: '' },
      mode: 'exam', // 'exam' or 'practice'
      timerSeconds: 120 * 60,
      timerInterval: null,
      currentIndex: 0,
      questions: [], // Shuffled or original
      subjective: [],
      answers: {}, // { qId: choiceKey }
      subjectiveAnswers: {}, // { subId: text }
      flags: new Set(),
      strikes: 0,
      strikeLog: [],
      isSubmitted: false,
      startTime: null,
      endTime: null,
      webhookUrl: localStorage.getItem('betong_webhook_url') || ''
    };

    this.init();
  }

  init() {
    this.populateCourseDropdown();
    this.attachEventListeners();
    this.initTheme();
    this.checkSavedSession();
  }

  // --- Theme Management ---
  initTheme() {
    const savedTheme = localStorage.getItem('betong_theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('betong_theme', isDark ? 'dark' : 'light');
  }

  // --- Populate Course List ---
  populateCourseDropdown() {
    const select = document.getElementById('courseSelect');
    if (!select) return;
    select.innerHTML = '<option value="">-- กรุณาเลือกรายวิชาสอบ --</option>';

    Object.keys(this.data).forEach(code => {
      const c = this.data[code];
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `[${c.course_code}] ${c.course_name} (${c.level})`;
      select.appendChild(opt);
    });
  }

  // --- Start Exam Session ---
  startExam() {
    const courseCode = document.getElementById('courseSelect').value;
    const studentId = document.getElementById('studentIdInput').value.trim();
    const studentName = document.getElementById('studentNameInput').value.trim();
    const studentLevel = document.getElementById('studentLevelInput').value.trim();
    const mode = document.querySelector('input[name="examMode"]:checked')?.value || 'exam';
    const pledgeCheck = document.getElementById('pledgeCheck').checked;

    if (!courseCode) {
      alert('กรุณาเลือกรายวิชาที่ต้องการเข้าสอบ');
      return;
    }
    if (!studentId || !studentName) {
      alert('กรุณากรอกรหัสนักศึกษา และชื่อ-นามสกุล ให้ครบถ้วน');
      return;
    }
    if (mode === 'exam' && !pledgeCheck) {
      alert('กรุณาทำเครื่องหมายยอมรับข้อตกลงและคำปฏิญาณตนความซื่อสัตย์ก่อนเริ่มทำข้อสอบ');
      return;
    }

    const course = this.data[courseCode];
    if (!course) {
      alert('ไม่พบข้อมูลรายวิชานี้ในระบบ');
      return;
    }

    this.state.courseId = courseCode;
    this.state.student = { id: studentId, name: studentName, level: studentLevel || course.level };
    this.state.mode = mode;
    this.state.startTime = new Date();
    this.state.timerSeconds = (course.time_minutes || 120) * 60;
    this.state.answers = {};
    this.state.subjectiveAnswers = {};
    this.state.flags.clear();
    this.state.strikes = 0;
    this.state.strikeLog = [];
    this.state.isSubmitted = false;

    // Clone & Shuffle Questions
    if (mode === 'exam') {
      this.state.questions = this.shuffleArray([...course.multiple_choice]).map(q => {
        const shuffledChoices = this.shuffleArray([...q.choices]);
        return { ...q, choices: shuffledChoices };
      });
    } else {
      this.state.questions = [...course.multiple_choice];
    }
    this.state.subjective = [...course.subjective];

    // Check for existing saved draft in LocalStorage
    this.loadSavedDraft();

    // Switch UI to Live Exam
    document.getElementById('screenLogin').classList.add('hidden');
    document.getElementById('screenExam').classList.remove('hidden');
    document.getElementById('screenResult').classList.add('hidden');

    this.updateHeaderInfo();
    this.renderQuestionNav();
    this.renderCurrentQuestion();

    if (mode === 'exam') {
      this.startTimer();
      this.enableAntiCheat();
      this.requestFullscreen();
    } else {
      document.getElementById('timerBadge').innerHTML = '💡 โหมดฝึกฝน / ติวสอบ';
      document.getElementById('timerBadge').className = 'px-3 py-1 bg-amber-100 text-amber-800 rounded-lg font-medium text-sm';
    }

    this.autoSave();
  }

  // --- Shuffle Utility (Fisher-Yates) ---
  shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // --- Header Update ---
  updateHeaderInfo() {
    const course = this.data[this.state.courseId];
    document.getElementById('examTitleHeader').textContent = `[${course.course_code}] ${course.course_name}`;
    document.getElementById('studentBadgeHeader').textContent = `${this.state.student.id} - ${this.state.student.name} (${this.state.student.level})`;
  }

  // --- Timer Engine ---
  startTimer() {
    if (this.state.timerInterval) clearInterval(this.state.timerInterval);

    const updateTimerDisplay = () => {
      const h = Math.floor(this.state.timerSeconds / 3600);
      const m = Math.floor((this.state.timerSeconds % 3600) / 60);
      const s = this.state.timerSeconds % 60;
      const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

      const badge = document.getElementById('timerBadge');
      badge.textContent = `⏳ เวลาคงเหลือ: ${formatted}`;

      if (this.state.timerSeconds <= 300) { // 5 mins
        badge.className = 'px-3 py-1 rounded-lg font-bold text-sm timer-urgent';
      } else if (this.state.timerSeconds <= 600) { // 10 mins
        badge.className = 'px-3 py-1 rounded-lg font-bold text-sm timer-warning';
      } else {
        badge.className = 'px-3 py-1 bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100 rounded-lg font-semibold text-sm';
      }

      if (this.state.timerSeconds <= 0) {
        clearInterval(this.state.timerInterval);
        alert('หมดเวลาทำข้อสอบแล้ว! ระบบจะทำการส่งข้อสอบของคุณโดยอัตโนมัติ');
        this.submitExam(true);
      } else {
        this.state.timerSeconds--;
      }
    };

    updateTimerDisplay();
    this.state.timerInterval = setInterval(updateTimerDisplay, 1000);
  }

  // --- Anti-Cheat Engine ---
  enableAntiCheat() {
    // Detect window blur and tab change
    this.handleVisibilityChange = () => {
      if (document.hidden && !this.state.isSubmitted && this.state.mode === 'exam') {
        this.triggerCheatStrike('สลับแท็บ / ย่อหน้าต่างเบราว์เซอร์');
      }
    };
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.handleWindowBlur = () => {
      if (!this.state.isSubmitted && this.state.mode === 'exam') {
        this.triggerCheatStrike('คลิกออกนอกหน้าต่างห้องสอบ');
      }
    };
    window.addEventListener('blur', this.handleWindowBlur);

    // Prevent Right-click and Copy
    document.oncontextmenu = (e) => {
      if (this.state.mode === 'exam') {
        e.preventDefault();
        return false;
      }
    };

    document.oncopy = (e) => {
      if (this.state.mode === 'exam') {
        e.preventDefault();
        return false;
      }
    };
  }

  disableAntiCheat() {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('blur', this.handleWindowBlur);
    document.oncontextmenu = null;
    document.oncopy = null;
  }

  triggerCheatStrike(reason) {
    this.state.strikes++;
    const now = new Date().toLocaleTimeString('th-TH');
    this.state.strikeLog.push({ time: now, reason: reason });

    const modal = document.getElementById('antiCheatModal');
    const msg = document.getElementById('antiCheatMessage');
    const count = document.getElementById('strikeCountText');

    msg.textContent = `ตรวจพบพฤติกรรม: "${reason}" กรุณาโฟกัสกับหน้าต่างข้อสอบเท่านั้น`;
    count.textContent = `แจ้งเตือนครั้งที่ ${this.state.strikes}/3`;
    modal.classList.remove('hidden');

    if (this.state.strikes >= 3) {
      count.textContent = `แจ้งเตือนครั้งที่ ${this.state.strikes} (บันทึกรายงานพฤติกรรมส่งอาจารย์)`;
    }

    this.autoSave();
  }

  closeAntiCheatModal() {
    document.getElementById('antiCheatModal').classList.add('hidden');
  }

  requestFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(() => {});
    }
  }

  // --- Render Question Navigation Grid ---
  renderQuestionNav() {
    const mcContainer = document.getElementById('navGridMC');
    const subContainer = document.getElementById('navGridSub');
    mcContainer.innerHTML = '';
    subContainer.innerHTML = '';

    // Multiple Choice 1 - 35
    this.state.questions.forEach((q, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-item';
      btn.textContent = idx + 1;
      btn.id = `navBtn_${idx}`;
      btn.onclick = () => this.goToQuestion(idx);

      if (this.state.answers[q.id]) btn.classList.add('answered');
      if (this.state.flags.has(idx)) btn.classList.add('flagged');
      if (this.state.currentIndex === idx) btn.classList.add('current');

      mcContainer.appendChild(btn);
    });

    // Subjective 1 - 3
    this.state.subjective.forEach((sub, sIdx) => {
      const actualIdx = this.state.questions.length + sIdx;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-item';
      btn.textContent = `อ${sIdx + 1}`;
      btn.id = `navBtn_${actualIdx}`;
      btn.onclick = () => this.goToQuestion(actualIdx);

      if (this.state.subjectiveAnswers[sub.id]?.trim()) btn.classList.add('answered');
      if (this.state.flags.has(actualIdx)) btn.classList.add('flagged');
      if (this.state.currentIndex === actualIdx) btn.classList.add('current');

      subContainer.appendChild(btn);
    });

    this.updateProgressSummary();
  }

  updateProgressSummary() {
    const totalMC = this.state.questions.length;
    const answeredMC = Object.keys(this.state.answers).length;
    const totalSub = this.state.subjective.length;
    const answeredSub = Object.values(this.state.subjectiveAnswers).filter(t => t && t.trim().length > 0).length;

    const total = totalMC + totalSub;
    const answered = answeredMC + answeredSub;
    const percent = Math.round((answered / total) * 100);

    document.getElementById('progressBarFill').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = `ตอบแล้ว ${answered}/${total} ข้อ (${percent}%)`;
  }

  // --- Go To Question ---
  goToQuestion(index) {
    const prevBtn = document.getElementById(`navBtn_${this.state.currentIndex}`);
    if (prevBtn) prevBtn.classList.remove('current');

    this.state.currentIndex = index;

    const newBtn = document.getElementById(`navBtn_${index}`);
    if (newBtn) newBtn.classList.add('current');

    this.renderCurrentQuestion();
  }

  nextQuestion() {
    const total = this.state.questions.length + this.state.subjective.length;
    if (this.state.currentIndex < total - 1) {
      this.goToQuestion(this.state.currentIndex + 1);
    }
  }

  prevQuestion() {
    if (this.state.currentIndex > 0) {
      this.goToQuestion(this.state.currentIndex - 1);
    }
  }

  toggleFlagCurrent() {
    const idx = this.state.currentIndex;
    const btn = document.getElementById(`navBtn_${idx}`);
    const flagBtn = document.getElementById('flagBtn');

    if (this.state.flags.has(idx)) {
      this.state.flags.delete(idx);
      if (btn) btn.classList.remove('flagged');
      flagBtn.innerHTML = '🚩 ปักหมุดทบทวน';
      flagBtn.className = 'px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700';
    } else {
      this.state.flags.add(idx);
      if (btn) btn.classList.add('flagged');
      flagBtn.innerHTML = '🚩 ปักหมุดแล้ว';
      flagBtn.className = 'px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600';
    }
    this.autoSave();
  }

  // --- Render Current Question Display ---
  renderCurrentQuestion() {
    const qIndex = this.state.currentIndex;
    const totalMC = this.state.questions.length;
    const card = document.getElementById('questionCard');

    // Update Flag button state
    const flagBtn = document.getElementById('flagBtn');
    if (this.state.flags.has(qIndex)) {
      flagBtn.innerHTML = '🚩 ปักหมุดแล้ว';
      flagBtn.className = 'px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600';
    } else {
      flagBtn.innerHTML = '🚩 ปักหมุดทบทวน';
      flagBtn.className = 'px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700';
    }

    // Toggle Prev / Next disabled states
    document.getElementById('prevBtn').disabled = (qIndex === 0);
    const isLast = (qIndex === totalMC + this.state.subjective.length - 1);
    document.getElementById('nextBtn').classList.toggle('hidden', isLast);
    document.getElementById('submitExamQuickBtn').classList.toggle('hidden', !isLast);

    if (qIndex < totalMC) {
      // Multiple Choice Question
      const q = this.state.questions[qIndex];
      const selectedChoice = this.state.answers[q.id];

      let html = `
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
          <div class="flex items-center gap-2">
            <span class="bg-blue-600 text-white px-3 py-1 rounded-md text-sm font-bold">ข้อที่ ${qIndex + 1} / ${totalMC}</span>
            <span class="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-0.5 rounded text-xs">หมวด: ${q.category || 'เนื้อหาหลัก'}</span>
          </div>
          <span class="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40 px-2.5 py-1 rounded">
            คะแนน: ${q.score || '0.86'} คะแนน
          </span>
        </div>

        <div class="text-lg font-medium text-slate-900 dark:text-slate-100 mb-6 leading-relaxed">
          ${this.formatQuestionText(q.question)}
        </div>

        <div class="space-y-3 mb-6">
      `;

      q.choices.forEach(ch => {
        const isSelected = (selectedChoice === ch.key);
        let extraClasses = '';

        if (this.state.mode === 'practice' && selectedChoice) {
          if (ch.key === q.correct_answer) {
            extraClasses = 'practice-correct';
          } else if (isSelected && ch.key !== q.correct_answer) {
            extraClasses = 'practice-wrong';
          }
        } else if (isSelected) {
          extraClasses = 'selected';
        }

        html += `
          <div class="choice-card p-4 rounded-xl flex items-start gap-3 ${extraClasses}" onclick="window.engine.selectChoice(${q.id}, '${ch.key}')">
            <div class="w-6 h-6 rounded-full border-2 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5
              ${isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}">
              ${ch.key}
            </div>
            <div class="text-slate-800 dark:text-slate-200 text-base leading-snug flex-1">
              ${this.escapeHtml(ch.text)}
            </div>
          </div>
        `;
      });

      html += `</div>`;

      // Practice Mode Explanation Box
      if (this.state.mode === 'practice' && selectedChoice) {
        const isCorrect = (selectedChoice === q.correct_answer);
        html += `
          <div class="mt-4 p-4 rounded-xl border ${isCorrect ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200' : 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'}">
            <div class="font-bold flex items-center gap-2 mb-1">
              <span>${isCorrect ? '✅ ถูกต้องยอดเยี่ยม!' : '❌ ยังไม่ถูกต้อง (คำตอบที่ถูกคือ ' + q.correct_answer + ')'}</span>
            </div>
            <div class="text-sm leading-relaxed mt-1">
              <strong>คำอธิบายเฉลย:</strong> ${q.explanation || 'ไม่มีคำอธิบายเพิ่มเติม'}
            </div>
          </div>
        `;
      }

      card.innerHTML = html;

    } else {
      // Subjective Question
      const sIndex = qIndex - totalMC;
      const sub = this.state.subjective[sIndex];
      const savedText = this.state.subjectiveAnswers[sub.id] || '';

      let html = `
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
          <div class="flex items-center gap-2">
            <span class="bg-amber-600 text-white px-3 py-1 rounded-md text-sm font-bold">ตอนที่ 2 ข้ออัตนัยที่ ${sIndex + 1} / ${this.state.subjective.length}</span>
            <span class="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-0.5 rounded text-xs">${sub.category || 'งานปฏิบัติและวิเคราะห์'}</span>
          </div>
          <span class="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/40 px-2.5 py-1 rounded">
            คะแนนเต็ม: ${sub.score || '3.33'} คะแนน
          </span>
        </div>

        <div class="text-lg font-medium text-slate-900 dark:text-slate-100 mb-4 leading-relaxed">
          ${this.formatQuestionText(sub.question)}
        </div>

        <div class="mb-4">
          <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
            ✍️ พิมพ์คำตอบ / โค้ดโปรแกรม / ขั้นตอนการทำงานของคุณที่นี่:
          </label>
          <textarea id="subAnswerText" rows="9"
            class="w-full p-4 font-mono text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
            placeholder="เขียนคำอธิบาย หรือโค้ดคำตอบของคุณ..."
            oninput="window.engine.saveSubjectiveAnswer(${sub.id}, this.value)">${this.escapeHtml(savedText)}</textarea>
          <span class="text-xs text-slate-500 dark:text-slate-400 mt-1 block">ระบบจะบันทึกคำตอบอัตโนมัติขณะพิมพ์</span>
        </div>
      `;

      if (this.state.mode === 'practice') {
        html += `
          <div class="mt-4 p-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200">
            <div class="font-bold mb-2">📖 แนวคำตอบและเกณฑ์การให้คะแนน (Model Solution & Rubric):</div>
            <pre class="code-block text-xs">${this.escapeHtml(sub.solution || 'ไม่มีแนวคำตอบระบุ')}</pre>
          </div>
        `;
      }

      card.innerHTML = html;
    }
  }

  // --- Select Multiple Choice ---
  selectChoice(qId, choiceKey) {
    this.state.answers[qId] = choiceKey;

    const btn = document.getElementById(`navBtn_${this.state.currentIndex}`);
    if (btn) btn.classList.add('answered');

    this.renderCurrentQuestion();
    this.updateProgressSummary();
    this.autoSave();
  }

  // --- Save Subjective Answer ---
  saveSubjectiveAnswer(subId, text) {
    this.state.subjectiveAnswers[subId] = text;

    const btn = document.getElementById(`navBtn_${this.state.currentIndex}`);
    if (btn) {
      if (text.trim().length > 0) {
        btn.classList.add('answered');
      } else {
        btn.classList.remove('answered');
      }
    }

    this.updateProgressSummary();
    this.autoSave();
  }

  // --- Text Formatting Helpers ---
  formatQuestionText(text) {
    if (!text) return '';
    // Check if text contains code blocks ``` ... ```
    if (text.includes('```')) {
      const parts = text.split(/```(?:c|cpp|python|html|js)?/g);
      let formatted = '';
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          formatted += `<pre class="code-block my-2"><code>${this.escapeHtml(parts[i].trim())}</code></pre>`;
        } else {
          formatted += this.escapeHtml(parts[i]).replace(/\n/g, '<br>');
        }
      }
      return formatted;
    }
    return this.escapeHtml(text).replace(/\n/g, '<br>');
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Auto-Save & Recovery ---
  autoSave() {
    if (!this.state.courseId || !this.state.student.id) return;
    const saveKey = `BetongExam_${this.state.student.id}_${this.state.courseId}`;
    const payload = {
      answers: this.state.answers,
      subjectiveAnswers: this.state.subjectiveAnswers,
      flags: Array.from(this.state.flags),
      strikes: this.state.strikes,
      strikeLog: this.state.strikeLog,
      timerSeconds: this.state.timerSeconds,
      startTime: this.state.startTime,
      mode: this.state.mode,
      timestamp: new Date().toISOString()
    };
    try {
      localStorage.setItem(saveKey, JSON.stringify(payload));
    } catch (e) {
      console.warn('LocalStorage save failed', e);
    }
  }

  loadSavedDraft() {
    const saveKey = `BetongExam_${this.state.student.id}_${this.state.courseId}`;
    const saved = localStorage.getItem(saveKey);
    if (saved) {
      try {
        const payload = JSON.parse(saved);
        this.state.answers = payload.answers || {};
        this.state.subjectiveAnswers = payload.subjectiveAnswers || {};
        this.state.flags = new Set(payload.flags || []);
        this.state.strikes = payload.strikes || 0;
        this.state.strikeLog = payload.strikeLog || [];
        if (payload.timerSeconds && payload.timerSeconds > 0) {
          this.state.timerSeconds = payload.timerSeconds;
        }
      } catch (e) {
        console.warn('Error restoring saved draft', e);
      }
    }
  }

  checkSavedSession() {
    // Optionally check if there was an active session
  }

  // --- Confirm Submission Modal ---
  openSubmitModal() {
    const totalMC = this.state.questions.length;
    const answeredMC = Object.keys(this.state.answers).length;
    const totalSub = this.state.subjective.length;
    const answeredSub = Object.values(this.state.subjectiveAnswers).filter(t => t && t.trim().length > 0).length;

    const unMC = totalMC - answeredMC;
    const unSub = totalSub - answeredSub;

    let msg = `คุณตอบข้อสอบปรนัยแล้ว ${answeredMC}/${totalMC} ข้อ และข้อเขียน ${answeredSub}/${totalSub} ข้อ`;
    if (unMC > 0 || unSub > 0) {
      msg += `\n\n⚠️ ยังมีข้อที่ยังไม่ได้ตอบ: ปรนัย ${unMC} ข้อ, อัตนัย ${unSub} ข้อ\nคุณแน่ใจหรือไม่ว่าต้องการส่งข้อสอบตอนนี้?`;
    } else {
      msg += `\n\nคุณทำข้อสอบครบถ้วนทุกข้อแล้ว ยืนยันการส่งข้อสอบหรือไม่?`;
    }

    if (confirm(msg)) {
      this.submitExam();
    }
  }

  // --- Final Submit & Scoring ---
  submitExam(isAuto = false) {
    this.state.isSubmitted = true;
    this.state.endTime = new Date();
    if (this.state.timerInterval) clearInterval(this.state.timerInterval);
    this.disableAntiCheat();

    // Grade Multiple Choice
    let correctCount = 0;
    let earnedMCScore = 0;
    const categoryStats = {};

    this.state.questions.forEach(q => {
      const cat = q.category || 'ทั่วไป';
      if (!categoryStats[cat]) {
        categoryStats[cat] = { total: 0, correct: 0, score: 0 };
      }
      categoryStats[cat].total++;

      const userAns = this.state.answers[q.id];
      if (userAns && userAns === q.correct_answer) {
        correctCount++;
        earnedMCScore += (q.score || 0.857);
        categoryStats[cat].correct++;
        categoryStats[cat].score += (q.score || 0.857);
      }
    });

    earnedMCScore = Math.min(30.0, Math.round(earnedMCScore * 10) / 10);

    // Prepare Result Data Object
    const course = this.data[this.state.courseId];
    const timeSpentSeconds = Math.round((this.state.endTime - new Date(this.state.startTime)) / 1000);
    const mSpent = Math.floor(timeSpentSeconds / 60);
    const sSpent = timeSpentSeconds % 60;

    const result = {
      courseCode: course.course_code,
      courseName: course.course_name,
      studentId: this.state.student.id,
      studentName: this.state.student.name,
      studentLevel: this.state.student.level,
      mode: this.state.mode,
      submittedAt: this.state.endTime.toLocaleString('th-TH'),
      timeSpent: `${mSpent} นาที ${sSpent} วินาที`,
      mcCorrect: correctCount,
      mcTotal: this.state.questions.length,
      mcScore: earnedMCScore,
      mcMaxScore: 30.0,
      subMaxScore: 10.0,
      subjectiveAnswers: this.state.subjectiveAnswers,
      strikes: this.state.strikes,
      strikeLog: this.state.strikeLog,
      categoryStats: categoryStats,
      rawAnswers: this.state.answers
    };

    // Store in browser submissions archive
    this.saveSubmissionToArchive(result);

    // Send Webhook to Google Sheets if configured
    if (this.state.webhookUrl) {
      this.sendWebhook(result);
    }

    // Switch UI to Result Screen
    document.getElementById('screenLogin').classList.add('hidden');
    document.getElementById('screenExam').classList.add('hidden');
    document.getElementById('screenResult').classList.remove('hidden');

    this.renderResultScreen(result);
  }

  renderResultScreen(result) {
    document.getElementById('resCourseName').textContent = `[${result.courseCode}] ${result.courseName}`;
    document.getElementById('resStudentName').textContent = `${result.studentName} (รหัส ${result.studentId})`;
    document.getElementById('resStudentLevel').textContent = result.studentLevel;
    document.getElementById('resSubmitTime').textContent = result.submittedAt;
    document.getElementById('resTimeSpent').textContent = result.timeSpent;

    document.getElementById('resMCScore').textContent = `${result.mcScore} / ${result.mcMaxScore}`;
    document.getElementById('resMCCount').textContent = `(ตอบถูก ${result.mcCorrect} จาก ${result.mcTotal} ข้อ)`;

    // Performance Badge
    const pct = (result.mcScore / result.mcMaxScore) * 100;
    const badge = document.getElementById('resGradeBadge');
    if (pct >= 80) {
      badge.textContent = '🌟 ผลการสอบระดับยอดเยี่ยม (เกรด 4.0)';
      badge.className = 'px-4 py-2 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-xl font-bold text-sm inline-block';
    } else if (pct >= 70) {
      badge.textContent = '👍 ผลการสอบระดับดีมาก (เกรด 3.0 - 3.5)';
      badge.className = 'px-4 py-2 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded-xl font-bold text-sm inline-block';
    } else if (pct >= 50) {
      badge.textContent = '✅ ผ่านเกณฑ์มาตรฐาน (เกรด 2.0 - 2.5)';
      badge.className = 'px-4 py-2 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded-xl font-bold text-sm inline-block';
    } else {
      badge.textContent = '⚠️ ต้องปรับปรุงเนื้อหาเพิ่มเติม (ต่ำกว่าเกณฑ์ 50%)';
      badge.className = 'px-4 py-2 bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 rounded-xl font-bold text-sm inline-block';
    }

    // Category Breakdown Table
    const catTbody = document.getElementById('resCategoryTbody');
    catTbody.innerHTML = '';
    Object.keys(result.categoryStats).forEach(cat => {
      const item = result.categoryStats[cat];
      const catPct = Math.round((item.correct / item.total) * 100);
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100 dark:border-slate-800';
      tr.innerHTML = `
        <td class="py-2.5 px-3 text-slate-800 dark:text-slate-200 font-medium">${this.escapeHtml(cat)}</td>
        <td class="py-2.5 px-3 text-center">${item.correct} / ${item.total}</td>
        <td class="py-2.5 px-3 text-right font-semibold">${item.score.toFixed(1)} คะแนน (${catPct}%)</td>
      `;
      catTbody.appendChild(tr);
    });

    // Anti-Cheat Audit Log
    const strikeBox = document.getElementById('resStrikeBox');
    if (result.strikes > 0) {
      strikeBox.classList.remove('hidden');
      document.getElementById('resStrikeCount').textContent = `${result.strikes} ครั้ง`;
      const logList = document.getElementById('resStrikeList');
      logList.innerHTML = result.strikeLog.map(l => `<li>[${l.time}] ${this.escapeHtml(l.reason)}</li>`).join('');
    } else {
      strikeBox.classList.add('hidden');
    }
  }

  saveSubmissionToArchive(result) {
    const listKey = 'BetongExam_Submissions';
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(listKey) || '[]');
    } catch (e) {}
    list.unshift(result);
    // Keep max 500
    if (list.length > 500) list = list.slice(0, 500);
    localStorage.setItem(listKey, JSON.stringify(list));
  }

  sendWebhook(result) {
    if (!this.state.webhookUrl) return;
    fetch(this.state.webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    }).catch(err => console.warn('Webhook dispatch failed', err));
  }

  // --- Print Result Sheet ---
  printResult() {
    window.print();
  }

  // --- Show Answers Review ---
  showReviewMode() {
    this.state.mode = 'practice';
    document.getElementById('screenResult').classList.add('hidden');
    document.getElementById('screenExam').classList.remove('hidden');
    document.getElementById('timerBadge').textContent = '📖 โหมดดูเฉลยละเอียดและทบทวนข้อสอบ';
    document.getElementById('timerBadge').className = 'px-3 py-1 bg-emerald-100 text-emerald-800 rounded-lg font-medium text-sm';
    this.goToQuestion(0);
  }

  returnHome() {
    if (confirm('คุณต้องการกลับสู่หน้าแรกเพื่อเลือกวิชาใหม่หรือไม่?')) {
      document.getElementById('screenLogin').classList.remove('hidden');
      document.getElementById('screenExam').classList.add('hidden');
      document.getElementById('screenResult').classList.add('hidden');
      document.getElementById('screenAdmin').classList.add('hidden');
    }
  }

  // --- Teacher Admin Panel ---
  openAdminPanel() {
    const pin = prompt('กรุณากรอกรหัสผ่านผู้ดูแลระบบ (Admin PIN):');
    if (pin === '1234') {
      document.getElementById('screenLogin').classList.add('hidden');
      document.getElementById('screenExam').classList.add('hidden');
      document.getElementById('screenResult').classList.add('hidden');
      document.getElementById('screenAdmin').classList.remove('hidden');
      this.renderAdminSubmissions();
    } else if (pin !== null) {
      alert('รหัสผ่านไม่ถูกต้อง');
    }
  }

  renderAdminSubmissions() {
    const listKey = 'BetongExam_Submissions';
    const list = JSON.parse(localStorage.getItem(listKey) || '[]');
    const tbody = document.getElementById('adminSubmissionsTbody');
    tbody.innerHTML = '';

    document.getElementById('adminTotalCount').textContent = `${list.length} รายการ`;
    document.getElementById('adminWebhookInput').value = this.state.webhookUrl;

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-slate-400">ยังไม่มีประวัติการส่งข้อสอบในเครื่องนี้</td></tr>';
      return;
    }

    list.forEach((item, i) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100 dark:border-slate-800 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50';
      tr.innerHTML = `
        <td class="py-3 px-3 text-slate-500">${i + 1}</td>
        <td class="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">${this.escapeHtml(item.courseCode)}</td>
        <td class="py-3 px-3 font-mono">${this.escapeHtml(item.studentId)}</td>
        <td class="py-3 px-3">${this.escapeHtml(item.studentName)}</td>
        <td class="py-3 px-3 text-center font-bold text-blue-600 dark:text-blue-400">${item.mcScore} / 30</td>
        <td class="py-3 px-3 text-center ${item.strikes > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}">${item.strikes} ครั้ง</td>
        <td class="py-3 px-3 text-slate-500 text-xs">${this.escapeHtml(item.submittedAt)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  exportSubmissionsCSV() {
    const listKey = 'BetongExam_Submissions';
    const list = JSON.parse(localStorage.getItem(listKey) || '[]');
    if (list.length === 0) {
      alert('ไม่มีข้อมูลสำหรับส่งออก');
      return;
    }

    let csv = '\uFEFF'; // UTF-8 BOM
    csv += 'ลำดับ,รหัสวิชา,ชื่อวิชา,รหัสนักศึกษา,ชื่อ-นามสกุล,ระดับชั้น,คะแนนปรนัย(เต็ม30),เวลาที่ใช้,การสลับแท็บ(ครั้ง),วันที่ส่ง\n';

    list.forEach((item, idx) => {
      csv += `"${idx + 1}","${item.courseCode}","${item.courseName}","${item.studentId}","${item.studentName}","${item.studentLevel}","${item.mcScore}","${item.timeSpent}","${item.strikes}","${item.submittedAt}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `สรุปคะแนนสอบปลายภาค_วกเบตง_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  }

  saveWebhookUrl() {
    const url = document.getElementById('adminWebhookInput').value.trim();
    this.state.webhookUrl = url;
    localStorage.setItem('betong_webhook_url', url);
    alert('บันทึกการตั้งค่า Webhook เรียบร้อยแล้ว!');
  }

  clearSubmissionsArchive() {
    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการล้างประวัติการส่งข้อสอบทั้งหมดในเครื่องนี้?')) {
      localStorage.removeItem('BetongExam_Submissions');
      this.renderAdminSubmissions();
    }
  }

  attachEventListeners() {
    // Top Theme Toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) themeBtn.onclick = () => this.toggleTheme();

    // Start Exam Button
    const startBtn = document.getElementById('startExamBtn');
    if (startBtn) startBtn.onclick = () => this.startExam();

    // Prev / Next Navigation
    const prevBtn = document.getElementById('prevBtn');
    if (prevBtn) prevBtn.onclick = () => this.prevQuestion();

    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) nextBtn.onclick = () => this.nextQuestion();

    // Flag Button
    const flagBtn = document.getElementById('flagBtn');
    if (flagBtn) flagBtn.onclick = () => this.toggleFlagCurrent();

    // Submit Buttons
    const submitBtn = document.getElementById('submitExamBtn');
    if (submitBtn) submitBtn.onclick = () => this.openSubmitModal();

    const quickSubmitBtn = document.getElementById('submitExamQuickBtn');
    if (quickSubmitBtn) quickSubmitBtn.onclick = () => this.openSubmitModal();

    // Result actions
    const printBtn = document.getElementById('printResultBtn');
    if (printBtn) printBtn.onclick = () => this.printResult();

    const reviewBtn = document.getElementById('reviewExamBtn');
    if (reviewBtn) reviewBtn.onclick = () => this.showReviewMode();

    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) homeBtn.onclick = () => this.returnHome();

    // Anti-cheat modal close
    const antiCheatBtn = document.getElementById('closeAntiCheatBtn');
    if (antiCheatBtn) antiCheatBtn.onclick = () => this.closeAntiCheatModal();

    // Admin Panel buttons
    const adminToggleBtn = document.getElementById('adminToggleBtn');
    if (adminToggleBtn) adminToggleBtn.onclick = () => this.openAdminPanel();

    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) exportCsvBtn.onclick = () => this.exportSubmissionsCSV();

    const saveWebhookBtn = document.getElementById('saveWebhookBtn');
    if (saveWebhookBtn) saveWebhookBtn.onclick = () => this.saveWebhookUrl();

    const clearArchiveBtn = document.getElementById('clearArchiveBtn');
    if (clearArchiveBtn) clearArchiveBtn.onclick = () => this.clearSubmissionsArchive();

    const closeAdminBtn = document.getElementById('closeAdminBtn');
    if (closeAdminBtn) closeAdminBtn.onclick = () => this.returnHome();
  }
}

// Instantiate Engine on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.engine = new ExamEngine();
});
