/* Audio: decoded SFX + looping music over WebAudio, with a tiny synth fallback for missing sounds. */
CG.Audio = class AudioSys {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.pending = {};
    this.music = null;
    this.musicKey = null;
    this.lastPlay = {};
    this.loops = {};
    const saved = CG.store.get("cg.audio", {});
    this.muted = !!saved.muted;
    this.musicVol = saved.musicVol != null ? saved.musicVol : 0.55;
    this.sfxVol = saved.sfxVol != null ? saved.sfxVol : 0.8;
  }

  _save() { CG.store.set("cg.audio", { muted: this.muted, musicVol: this.musicVol, sfxVol: this.sfxVol }); }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = this.sfxVol; this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.musicVol; this.musicBus.connect(this.master);
    for (const k in this.pending) this._decode(k, this.pending[k]);
    this.pending = {};
  }

  unlock() {
    this.init();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  _decode(key, src) {
    try {
      const b64 = src.slice(src.indexOf(",") + 1);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.ctx.decodeAudioData(bytes.buffer, (buf) => {
        this.buffers[key] = buf;
        if (this.wantMusic && "music:" + this.wantMusic === key && !this.music) this.playMusic(this.wantMusic, 0.6);
      }, () => console.warn("[ComfyGame] could not decode audio", key));
    } catch (e) { console.warn("[ComfyGame] bad audio data", key, e); }
  }

  load(key, src) {
    if (!src) return;
    if (this.ctx) this._decode(key, src); else this.pending[key] = src;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    this._save();
    return this.muted;
  }

  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (this.lastPlay[name] && now - this.lastPlay[name] < (opts.gap || 0.035)) return;
    this.lastPlay[name] = now;
    const buf = this.buffers["sfx:" + name];
    const gain = this.ctx.createGain();
    gain.gain.value = opts.vol != null ? opts.vol : 1;
    let out = gain;
    if (opts.pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = clamp(opts.pan, -1, 1); gain.connect(p); out = p;
    }
    out.connect(this.sfxBus);
    if (buf) {
      const s = this.ctx.createBufferSource();
      s.buffer = buf;
      const vary = opts.vary != null ? opts.vary : 0.06;
      s.playbackRate.value = (opts.pitch || 1) * (1 + (Math.random() * 2 - 1) * vary);
      s.connect(gain);
      s.start();
    } else {
      this._synth(name, gain, opts.pitch || 1);
    }
  }

  // Fallback blips so a game without generated audio still has feedback.
  _synth(name, dest, pitch) {
    const c = this.ctx, t = c.currentTime;
    const presets = {
      jump: ["square", 300, 600, 0.12, 0.25], coin: ["square", 900, 1400, 0.1, 0.2], hit: ["sawtooth", 220, 80, 0.15, 0.3],
      hurt: ["sawtooth", 300, 60, 0.3, 0.35], shoot: ["square", 700, 200, 0.08, 0.15], explode: ["noise", 0, 0, 0.45, 0.5],
      select: ["square", 500, 500, 0.06, 0.15], powerup: ["triangle", 300, 1200, 0.35, 0.3], land: ["triangle", 120, 60, 0.06, 0.2],
      dash: ["noise", 0, 0, 0.12, 0.25], die: ["square", 400, 50, 0.6, 0.35], step: ["triangle", 90, 70, 0.03, 0.08],
    };
    const p = presets[name] || presets.select;
    const env = c.createGain();
    env.gain.setValueAtTime(p[4], t);
    env.gain.exponentialRampToValueAtTime(0.001, t + p[3]);
    env.connect(dest);
    if (p[0] === "noise") {
      const len = Math.floor(c.sampleRate * p[3]);
      const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = c.createBufferSource(); s.buffer = b; s.connect(env); s.start(t);
    } else {
      const o = c.createOscillator();
      o.type = p[0];
      o.frequency.setValueAtTime(p[1] * pitch, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, p[2] * pitch), t + p[3]);
      o.connect(env); o.start(t); o.stop(t + p[3] + 0.02);
    }
  }

  playMusic(key, fade = 1.0) {
    this.wantMusic = key;
    if (!this.ctx) return;
    if (this.musicKey === key && this.music) return;
    const buf = this.buffers["music:" + key] || this.buffers[key];
    if (!buf) return;
    this.stopMusic(fade);
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    const lp = this.loops["music:" + key];
    if (lp && lp[1] <= buf.duration + 0.01) { s.loopStart = lp[0]; s.loopEnd = Math.min(lp[1], buf.duration); }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(1, this.ctx.currentTime + Math.max(0.05, fade));
    s.connect(g); g.connect(this.musicBus);
    s.start();
    this.music = { s, g };
    this.musicKey = key;
  }

  stopMusic(fade = 0.8) {
    if (!this.music || !this.ctx) { this.music = null; this.musicKey = null; return; }
    const { s, g } = this.music;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
    try { s.stop(t + fade + 0.05); } catch (e) { /* already stopped */ }
    this.music = null;
    this.musicKey = null;
  }

  duck(on) {
    if (!this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(on ? this.musicVol * 0.3 : this.musicVol, this.ctx.currentTime, 0.08);
  }

  // One-shot music sting (level clear, game over) that ducks the loop.
  jingle(key) {
    if (!this.ctx || this.muted) return;
    const buf = this.buffers["jingle:" + key];
    if (!buf) { this.play(key === "win" ? "powerup" : "die"); return; }
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.connect(this.musicBus); s.start();
  }
};
