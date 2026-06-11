"use strict";var xt=Object.create;var X=Object.defineProperty;var wt=Object.getOwnPropertyDescriptor;var kt=Object.getOwnPropertyNames;var Pt=Object.getPrototypeOf,Ft=Object.prototype.hasOwnProperty;var $t=(r,e)=>{for(var t in e)X(r,t,{get:e[t],enumerable:!0})},Re=(r,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of kt(e))!Ft.call(r,n)&&n!==t&&X(r,n,{get:()=>e[n],enumerable:!(s=wt(e,n))||s.enumerable});return r};var M=(r,e,t)=>(t=r!=null?xt(Pt(r)):{},Re(e||!r||!r.__esModule?X(t,"default",{value:r,enumerable:!0}):t,r)),Gt=r=>Re(X({},"__esModule",{value:!0}),r);var fs={};$t(fs,{generateContext:()=>he});module.exports=Gt(fs);var vt=M(require("path"),1),yt=require("os"),Ut=require("fs");var de=require("bun:sqlite");var f=require("path"),re=require("os"),D=require("fs");var Ne=require("url");var L=require("fs"),Ae=require("path");var te=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(te||{}),se=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=x.logsDir();(0,L.existsSync)(e)||(0,L.mkdirSync)(e,{recursive:!0});let t=new Date().toISOString().split("T")[0];this.logFilePath=(0,Ae.join)(e,`claude-mem-${t}.log`)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e instanceof Error?e.message:String(e)),this.logFilePath=null}}}getLevel(){if(this.level===null)try{let e=x.settings();if((0,L.existsSync)(e)){let t=(0,L.readFileSync)(e,"utf-8"),n=(JSON.parse(t).CLAUDE_MEM_LOG_LEVEL||"INFO").toUpperCase();this.level=te[n]??1}else this.level=1}catch(e){console.error("[LOGGER] Failed to load log level from settings:",e instanceof Error?e.message:String(e)),this.level=1}return this.level}correlationId(e,t){return`obs-${e}-${t}`}sessionId(e){return`session-${e}`}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?JSON.stringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let s=t;if(typeof t=="string")try{s=JSON.parse(t)}catch{s=t}if(e==="Bash"&&s.command)return`${e}(${s.command})`;if(s.file_path)return`${e}(${s.file_path})`;if(s.notebook_path)return`${e}(${s.notebook_path})`;if(e==="Glob"&&s.pattern)return`${e}(${s.pattern})`;if(e==="Grep"&&s.pattern)return`${e}(${s.pattern})`;if(s.url)return`${e}(${s.url})`;if(s.query)return`${e}(${s.query})`;if(e==="Task"){if(s.subagent_type)return`${e}(${s.subagent_type})`;if(s.description)return`${e}(${s.description})`}return e==="Skill"&&s.skill?`${e}(${s.skill})`:e==="LSP"&&s.operation?`${e}(${s.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${s}-${n} ${o}:${i}:${a}.${d}`}log(e,t,s,n,o){if(e<this.getLevel())return;this.ensureLogFileInitialized();let i=this.formatTimestamp(new Date),a=te[e].padEnd(5),d=t.padEnd(6),p="";n?.correlationId?p=`[${n.correlationId}] `:n?.sessionId&&(p=`[session-${n.sessionId}] `);let u="";if(o!=null)if(o instanceof Error)u=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`;else if(this.getLevel()===0&&typeof o=="object")try{u=`
`+JSON.stringify(o,null,2)}catch{u=" "+this.formatData(o)}else u=" "+this.formatData(o);let E="";if(n){let{sessionId:T,memorySessionId:S,correlationId:b,...l}=n;Object.keys(l).length>0&&(E=` {${Object.entries(l).map(([h,m])=>`${h}=${m}`).join(", ")}}`)}let g=`[${i}] [${a}] [${d}] ${p}${s}${E}${u}`;if(this.logFilePath)try{(0,L.appendFileSync)(this.logFilePath,g+`
`,"utf8")}catch(T){process.stderr.write(`[LOGGER] Failed to write to log file: ${T instanceof Error?T.message:String(T)}
`)}else process.stderr.write(g+`
`)}debug(e,t,s,n){this.log(0,e,t,s,n)}info(e,t,s,n){this.log(1,e,t,s,n)}warn(e,t,s,n){this.log(2,e,t,s,n)}error(e,t,s,n){this.log(3,e,t,s,n)}dataIn(e,t,s,n){this.info(e,`\u2192 ${t}`,s,n)}dataOut(e,t,s,n){this.info(e,`\u2190 ${t}`,s,n)}success(e,t,s,n){this.info(e,`\u2713 ${t}`,s,n)}failure(e,t,s,n){this.error(e,`\u2717 ${t}`,s,n)}timing(e,t,s,n){this.info(e,`\u23F1 ${t}`,n,{duration:`${s}ms`})}happyPathError(e,t,s,n,o=""){let p=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),u=p?`${p[1].split("/").pop()}:${p[2]}`:"unknown",E={...s,location:u};return this.warn(e,`[HAPPY-PATH] ${t}`,E,n),o}},c=new se;var Jt={};function Ht(){return typeof __dirname<"u"?__dirname:(0,f.dirname)((0,Ne.fileURLToPath)(Jt.url))}var Xt=Ht();function jt(){if(process.env.CLAUDE_MEM_DATA_DIR)return process.env.CLAUDE_MEM_DATA_DIR;let r=(0,f.join)((0,re.homedir)(),".claude-mem"),e=(0,f.join)(r,"settings.json");try{if((0,D.existsSync)(e)){let t=JSON.parse((0,D.readFileSync)(e,"utf-8")),s=t.env??t;if(s.CLAUDE_MEM_DATA_DIR)return s.CLAUDE_MEM_DATA_DIR}}catch{}return r}var O=jt(),v=process.env.CLAUDE_CONFIG_DIR||(0,f.join)((0,re.homedir)(),".claude"),As=(0,f.join)(v,"plugins","marketplaces","thedotmack"),Bt=(0,f.join)(O,"archives"),Wt=(0,f.join)(O,"logs"),qt=(0,f.join)(O,"trash"),Yt=(0,f.join)(O,"backups"),Kt=(0,f.join)(O,"modes"),Ns=(0,f.join)(O,"settings.json"),Ce=(0,f.join)(O,"claude-mem.db"),Vt=(0,f.join)(O,"vector-db"),Ie=(0,f.join)(O,"observer-sessions"),ne=(0,f.basename)(Ie),Cs=(0,f.join)(v,"settings.json"),Is=(0,f.join)(v,"commands"),Ls=(0,f.join)(v,"CLAUDE.md");function Le(r){(0,D.mkdirSync)(r,{recursive:!0})}function Me(){return(0,f.join)(Xt,"..")}var x={dataDir:()=>O,workerPid:()=>(0,f.join)(O,"worker.pid"),settings:()=>(0,f.join)(O,"settings.json"),database:()=>(0,f.join)(O,"claude-mem.db"),chroma:()=>(0,f.join)(O,"chroma"),combinedCerts:()=>(0,f.join)(O,"combined_certs.pem"),transcriptsConfig:()=>(0,f.join)(O,"transcript-watch.json"),transcriptsState:()=>(0,f.join)(O,"transcript-watch-state.json"),corpora:()=>(0,f.join)(O,"corpora"),supervisorRegistry:()=>(0,f.join)(O,"supervisor.json"),envFile:()=>(0,f.join)(O,".env"),logsDir:()=>Wt,archives:()=>Bt,trash:()=>qt,backups:()=>Yt,modes:()=>Kt,vectorDb:()=>Vt,observerSessions:()=>Ie};var we=require("crypto");var ye=require("os"),oe=M(require("path"),1);var B=require("fs"),j=M(require("path"),1),w={isWorktree:!1,worktreeName:null,parentRepoPath:null,parentProjectName:null};function De(r){let e=j.default.join(r,".git"),t;try{t=(0,B.statSync)(e)}catch(u){return u instanceof Error&&u.code!=="ENOENT"&&console.warn("[worktree] Unexpected error checking .git:",u),w}if(!t.isFile())return w;let s;try{s=(0,B.readFileSync)(e,"utf-8").trim()}catch(u){return console.warn("[worktree] Failed to read .git file:",u instanceof Error?u.message:String(u)),w}let n=s.match(/^gitdir:\s*(.+)$/);if(!n)return w;let i=n[1].match(/^(.+)[/\\]\.git[/\\]worktrees[/\\]([^/\\]+)$/);if(!i)return w;let a=i[1],d=j.default.basename(r),p=j.default.basename(a);return{isWorktree:!0,worktreeName:d,parentRepoPath:a,parentProjectName:p}}var W=require("fs"),k=M(require("path"),1);function ve(r){if(!r||r.trim()==="")return null;let e;try{e=k.default.resolve(r)}catch{return null}let t=k.default.parse(e).root;for(;;){let s=k.default.join(e,".git");if((0,W.existsSync)(s))try{return(0,W.statSync)(s),e}catch{return null}if(e===t)return null;let n=k.default.dirname(e);if(n===e)return null;e=n}}function Ue(r){return r==="~"||r.startsWith("~/")?r.replace(/^~/,(0,ye.homedir)()):r}function xe(r){let e=oe.default.basename(r);if(e!=="")return e;if(process.platform==="win32"){let s=r.match(/^([A-Z]):\\/i);if(s){let o=`drive-${s[1].toUpperCase()}`;return c.info("PROJECT_NAME","Drive root detected",{cwd:r,projectName:o}),o}}return c.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:r}),"unknown-project"}function Qt(r){if(!r||r.trim()==="")return c.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:r}),"unknown-project";let e=Ue(r),t=ve(e);return t?oe.default.basename(t):xe(e)}function ie(r){let e=Qt(r);if(!r)return{primary:e,parent:null,isWorktree:!1,allProjects:[e]};let t=Ue(r),s=De(t),n=xe(t),o=[e];if(n!==e&&!o.includes(n)&&o.push(n),s.isWorktree&&s.parentProjectName){let i=`${s.parentProjectName}/${e}`,a=[s.parentProjectName,i];return n!==e&&!a.includes(n)&&a.push(n),{primary:i,parent:s.parentProjectName,isWorktree:!0,allProjects:a}}return{primary:e,parent:null,isWorktree:!1,allProjects:o}}function q(r,e,t){return(0,we.createHash)("sha256").update([r||"",e||"",t||""].join("\0")).digest("hex").slice(0,16)}function ae(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[String(e)]}catch{return[r]}}var A="claude";function zt(r){return r.trim().toLowerCase().replace(/\s+/g,"-")}function y(r){if(!r)return A;let e=zt(r);return e?e==="transcript"||e.includes("codex")?"codex":e.includes("cursor")?"cursor":e.includes("claude")?"claude":e:A}function ke(r){let e=["claude","codex","cursor"];return[...r].sort((t,s)=>{let n=e.indexOf(t),o=e.indexOf(s);return n!==-1||o!==-1?n===-1?1:o===-1?-1:n-o:t.localeCompare(s)})}function Zt(r,e){return{customTitle:r,platformSource:e?y(e):void 0}}var Y=class{db;constructor(e=Ce){e instanceof de.Database?this.db=e:(e!==":memory:"&&Le(O),this.db=new de.Database(e),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA foreign_keys = ON"),this.db.run("PRAGMA journal_size_limit = 4194304")),this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.addSessionPlatformSourceColumn(),this.addObservationModelColumns(),this.ensureMergedIntoProjectColumns(),this.addObservationSubagentColumns(),this.addPendingMessagesToolUseIdAndWorkerPidColumns(),this.addObservationsUniqueContentHashIndex(),this.addObservationsMetadataColumn(),this.dropDeadPendingMessagesColumns(),this.dropWorkerPidColumn(),this.addObservationDigestsTable()}dropWorkerPidColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(32))return;if(this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="worker_pid"))try{this.db.run("DROP INDEX IF EXISTS idx_pending_messages_worker_pid"),this.db.run("ALTER TABLE pending_messages DROP COLUMN worker_pid"),c.debug("DB","Dropped worker_pid column and its index from pending_messages")}catch(n){c.warn("DB","Failed to drop worker_pid column from pending_messages",{},n instanceof Error?n:new Error(String(n)))}this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(32,new Date().toISOString())}dropDeadPendingMessagesColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(31))return;let t=this.db.query("PRAGMA table_info(pending_messages)").all(),s=new Set(t.map(i=>i.name)),o=["retry_count","failed_at_epoch","completed_at_epoch","worker_pid"].filter(i=>s.has(i));if(o.length>0){this.db.run("DELETE FROM pending_messages WHERE status NOT IN ('pending', 'processing')");for(let i of o)try{this.db.run(`ALTER TABLE pending_messages DROP COLUMN ${i}`),c.debug("DB",`Dropped dead column ${i} from pending_messages`)}catch(a){c.warn("DB",`Failed to drop column ${i} from pending_messages`,{},a instanceof Error?a:new Error(String(a)))}}this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString())}initializeSchema(){this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT UNIQUE NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        platform_source TEXT NOT NULL DEFAULT 'claude',
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT UNIQUE NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(s=>s.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),c.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),c.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),c.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),c.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(s=>s.unique===1&&s.origin!=="pk")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}c.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),c.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}c.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),c.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}c.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),c.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}c.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(content_session_id) REFERENCES sdk_sessions(content_session_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(content_session_id, prompt_number);
    `);let s=`
      CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
        prompt_text,
        content='user_prompts',
        content_rowid='id'
      );
    `,n=`
      CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;

      CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
      END;

      CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;
    `;try{this.db.run(s),this.db.run(n)}catch(o){o instanceof Error?c.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},o):c.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},new Error(String(o))),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),c.debug("DB","Created user_prompts table (without FTS5)");return}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),c.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),c.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),c.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}c.debug("DB","Creating pending_messages table"),this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing')),
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),c.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;c.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(u=>u.name===o);return a.some(u=>u.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),c.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(c.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?c.debug("DB",`Successfully renamed ${t} session ID columns`):c.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),c.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21))return;c.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new");let s=this.db.query("PRAGMA table_info(observations)").all().some(S=>S.name==="metadata"),n=s?`,
        metadata TEXT`:"",o=s?", metadata":"",i=`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL${n},
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `,a=`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             discovery_tokens, created_at, created_at_epoch${o}
      FROM observations
    `,d=`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `,p=`
      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;
    `;this.db.run("DROP TRIGGER IF EXISTS session_summaries_ai"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ad"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_au"),this.db.run("DROP TABLE IF EXISTS session_summaries_new");let u=`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `,E=`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, discovery_tokens, created_at, created_at_epoch
      FROM session_summaries
    `,g=`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `,T=`
      CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;
    `;try{this.recreateObservationsWithCascade(i,a,d,p),this.recreateSessionSummariesWithCascade(u,E,g,T),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),c.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(S){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),S instanceof Error?S:new Error(String(S))}}recreateObservationsWithCascade(e,t,s,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(s),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run(n)}recreateSessionSummariesWithCascade(e,t,s,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(s),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all().length>0&&this.db.run(n)}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),c.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),c.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}addSessionPlatformSourceColumn(){let t=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source"),n=this.db.query("PRAGMA index_list(sdk_sessions)").all().some(i=>i.name==="idx_sdk_sessions_platform_source");this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)&&t&&n||(t||(this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${A}'`),c.debug("DB","Added platform_source column to sdk_sessions table")),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${A}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),n||this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(24,new Date().toISOString()))}addObservationModelColumns(){let e=this.db.query("PRAGMA table_info(observations)").all(),t=e.some(n=>n.name==="generated_by_model"),s=e.some(n=>n.name==="relevance_count");t&&s||(t||this.db.run("ALTER TABLE observations ADD COLUMN generated_by_model TEXT"),s||this.db.run("ALTER TABLE observations ADD COLUMN relevance_count INTEGER DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(26,new Date().toISOString()))}ensureMergedIntoProjectColumns(){this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="merged_into_project")||this.db.run("ALTER TABLE observations ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_merged_into ON observations(merged_into_project)"),this.db.query("PRAGMA table_info(session_summaries)").all().some(s=>s.name==="merged_into_project")||this.db.run("ALTER TABLE session_summaries ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_merged_into ON session_summaries(merged_into_project)")}addObservationSubagentColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(27),t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(i=>i.name==="agent_type"),n=t.some(i=>i.name==="agent_id");s||this.db.run("ALTER TABLE observations ADD COLUMN agent_type TEXT"),n||this.db.run("ALTER TABLE observations ADD COLUMN agent_id TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_type ON observations(agent_type)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_id ON observations(agent_id)");let o=this.db.query("PRAGMA table_info(pending_messages)").all();if(o.length>0){let i=o.some(d=>d.name==="agent_type"),a=o.some(d=>d.name==="agent_id");i||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_type TEXT"),a||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_id TEXT")}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString())}addPendingMessagesToolUseIdAndWorkerPidColumns(){if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString());return}let t=this.db.query("PRAGMA table_info(pending_messages)").all(),s=t.some(o=>o.name==="tool_use_id"),n=t.some(o=>o.name==="worker_pid");s||this.db.run("ALTER TABLE pending_messages ADD COLUMN tool_use_id TEXT"),n||this.db.run("ALTER TABLE pending_messages ADD COLUMN worker_pid INTEGER"),this.db.run("BEGIN TRANSACTION");try{this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_worker_pid ON pending_messages(worker_pid)"),this.db.run(`
        DELETE FROM pending_messages
         WHERE tool_use_id IS NOT NULL
           AND id NOT IN (
             SELECT MIN(id) FROM pending_messages
              WHERE tool_use_id IS NOT NULL
              GROUP BY content_session_id, tool_use_id
           )
      `),this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_session_tool
        ON pending_messages(content_session_id, tool_use_id)
        WHERE tool_use_id IS NOT NULL
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString()),this.db.run("COMMIT")}catch(o){throw this.db.run("ROLLBACK"),o}}addObservationsUniqueContentHashIndex(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(29))return;let t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(o=>o.name==="memory_session_id"),n=t.some(o=>o.name==="content_hash");if(!s||!n){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString());return}this.db.run("BEGIN TRANSACTION");try{this.db.run(`
        DELETE FROM observations
         WHERE id NOT IN (
           SELECT MIN(id) FROM observations
            GROUP BY memory_session_id, content_hash
         )
      `),this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_observations_session_hash
        ON observations(memory_session_id, content_hash)
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString()),this.db.run("COMMIT")}catch(o){throw this.db.run("ROLLBACK"),o}}addObservationsMetadataColumn(){this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="metadata")||(this.db.run("ALTER TABLE observations ADD COLUMN metadata TEXT"),c.debug("DB","Added metadata column to observations table (#2116)")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(30,new Date().toISOString())}addObservationDigestsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(33))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='observation_digests'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString());return}c.debug("DB","Creating observation_digests table"),this.db.run(`
      CREATE TABLE observation_digests (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        project              TEXT    NOT NULL,
        period_start_epoch   INTEGER NOT NULL,
        period_end_epoch     INTEGER NOT NULL,
        period_kind          TEXT    NOT NULL CHECK(period_kind IN ('weekly', 'monthly')),
        obs_count            INTEGER NOT NULL,
        dominant_types       TEXT,
        dominant_concepts    TEXT,
        summary_text         TEXT    NOT NULL,
        facts                TEXT,
        files_touched        TEXT,
        created_at           TEXT    NOT NULL,
        created_at_epoch     INTEGER NOT NULL,
        UNIQUE(project, period_kind, period_start_epoch)
      )
    `),this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_digests_project_period
        ON observation_digests(project, period_kind, period_start_epoch DESC)
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString()),c.info("DB","observation_digests table created successfully")}updateMemorySessionId(e,t){this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(t,e)}markSessionCompleted(e){let t=Date.now(),s=new Date(t).toISOString();this.db.prepare(`
      UPDATE sdk_sessions
      SET status = 'completed', completed_at = ?, completed_at_epoch = ?
      WHERE id = ?
    `).run(s,t,e)}ensureMemorySessionIdRegistered(e,t){let s=this.db.prepare(`
      SELECT id, memory_session_id FROM sdk_sessions WHERE id = ?
    `).get(e);if(!s)throw new Error(`Session ${e} not found in sdk_sessions`);s.memory_session_id!==t&&(this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(t,e),c.info("DB","Registered memory_session_id before storage (FK fix)",{sessionDbId:e,oldId:s.memory_session_id,newId:t}))}getRecentSummaries(e,t=10){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentSummariesWithSessionInfo(e,t=3){return this.db.prepare(`
      SELECT
        memory_session_id, request, learned, completed, next_steps,
        prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentObservations(e,t=20){return this.db.prepare(`
      SELECT type, text, prompt_number, created_at
      FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getAllRecentObservations(e=100){return this.db.prepare(`
      SELECT
        o.id,
        o.type,
        o.title,
        o.subtitle,
        o.text,
        o.project,
        COALESCE(s.platform_source, '${A}') as platform_source,
        o.prompt_number,
        o.created_at,
        o.created_at_epoch
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      ORDER BY o.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentSummaries(e=50){return this.db.prepare(`
      SELECT
        ss.id,
        ss.request,
        ss.investigated,
        ss.learned,
        ss.completed,
        ss.next_steps,
        ss.files_read,
        ss.files_edited,
        ss.notes,
        ss.project,
        COALESCE(s.platform_source, '${A}') as platform_source,
        ss.prompt_number,
        ss.created_at,
        ss.created_at_epoch
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
      ORDER BY ss.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentUserPrompts(e=100){return this.db.prepare(`
      SELECT
        up.id,
        up.content_session_id,
        s.project,
        COALESCE(s.platform_source, '${A}') as platform_source,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
      LEFT JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      ORDER BY up.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllProjects(e){let t=e?y(e):void 0,s=`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
    `,n=[ne];return t&&(s+=" AND COALESCE(platform_source, ?) = ?",n.push(A,t)),s+=" ORDER BY project ASC",this.db.prepare(s).all(...n).map(i=>i.project)}getProjectCatalog(){let e=this.db.prepare(`
      SELECT
        COALESCE(platform_source, '${A}') as platform_source,
        project,
        MAX(started_at_epoch) as latest_epoch
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
      GROUP BY COALESCE(platform_source, '${A}'), project
      ORDER BY latest_epoch DESC
    `).all(ne),t=[],s=new Set,n={};for(let i of e){let a=y(i.platform_source);n[a]||(n[a]=[]),n[a].includes(i.project)||n[a].push(i.project),s.has(i.project)||(s.add(i.project),t.push(i.project))}let o=ke(Object.keys(n));return{projects:t,sources:o,projectsBySource:Object.fromEntries(o.map(i=>[i,n[i]||[]]))}}getLatestUserPrompt(e){return this.db.prepare(`
      SELECT
        up.*,
        s.memory_session_id,
        s.project,
        COALESCE(s.platform_source, '${A}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.content_session_id = ?
      ORDER BY up.created_at_epoch DESC
      LIMIT 1
    `).get(e)}getRecentSessionsWithStatus(e,t=3){return this.db.prepare(`
      SELECT * FROM (
        SELECT
          s.memory_session_id,
          s.status,
          s.started_at,
          s.started_at_epoch,
          s.user_prompt,
          CASE WHEN sum.memory_session_id IS NOT NULL THEN 1 ELSE 0 END as has_summary
        FROM sdk_sessions s
        LEFT JOIN session_summaries sum ON s.memory_session_id = sum.memory_session_id
        WHERE s.project = ? AND s.memory_session_id IS NOT NULL
        GROUP BY s.memory_session_id
        ORDER BY s.started_at_epoch DESC
        LIMIT ?
      )
      ORDER BY started_at_epoch ASC
    `).all(e,t)}getObservationsForSession(e){return this.db.prepare(`
      SELECT title, subtitle, type, prompt_number
      FROM observations
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch ASC
    `).all(e)}getObservationById(e){return this.db.prepare(`
      SELECT *
      FROM observations
      WHERE id = ?
    `).get(e)||null}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,type:i,concepts:a,files:d}=t,p=s==="relevance",u=p?"":`ORDER BY created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,E=n?`LIMIT ${n}`:"",g=e.map(()=>"?").join(","),T=[...e],S=[];if(o&&(S.push("project = ?"),T.push(o)),i)if(Array.isArray(i)){let m=i.map(()=>"?").join(",");S.push(`type IN (${m})`),T.push(...i)}else S.push("type = ?"),T.push(i);if(a){let m=Array.isArray(a)?a:[a],I=m.map(()=>"EXISTS (SELECT 1 FROM json_each(concepts) WHERE value = ?)");T.push(...m),S.push(`(${I.join(" OR ")})`)}if(d){let m=Array.isArray(d)?d:[d],I=m.map(()=>"(EXISTS (SELECT 1 FROM json_each(files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(files_modified) WHERE value LIKE ?))");m.forEach(U=>{T.push(`%${U}%`,`%${U}%`)}),S.push(`(${I.join(" OR ")})`)}let b=S.length>0?`WHERE id IN (${g}) AND ${S.join(" AND ")}`:`WHERE id IN (${g})`,R=this.db.prepare(`
      SELECT *
      FROM observations
      ${b}
      ${u}
      ${E}
    `).all(...T);if(!p)return R;let h=new Map(R.map(m=>[m.id,m]));return e.map(m=>h.get(m)).filter(m=>!!m)}getSummaryForSession(e){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `).get(e)||null}getFilesForSession(e){let s=this.db.prepare(`
      SELECT files_read, files_modified
      FROM observations
      WHERE memory_session_id = ?
    `).all(e),n=new Set,o=new Set;for(let i of s)ae(i.files_read).forEach(a=>n.add(a)),ae(i.files_modified).forEach(a=>o.add(a));return{filesRead:Array.from(n),filesModified:Array.from(o)}}getSessionById(e){return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${A}') as platform_source,
             user_prompt, custom_title, status
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getSdkSessionsBySessionIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${A}') as platform_source,
             user_prompt, custom_title,
             started_at, started_at_epoch, completed_at, completed_at_epoch, status
      FROM sdk_sessions
      WHERE memory_session_id IN (${t})
      ORDER BY started_at_epoch DESC
    `).all(...e)}getPromptNumberFromUserPrompts(e){return this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE content_session_id = ?
    `).get(e).count}createSDKSession(e,t,s,n,o){let i=new Date,a=i.getTime(),d=Zt(n,o),p=d.platformSource??A,u=this.db.prepare(`
      SELECT id, platform_source FROM sdk_sessions WHERE content_session_id = ?
    `).get(e);if(u){if(t&&this.db.prepare(`
          UPDATE sdk_sessions SET project = ?
          WHERE content_session_id = ? AND (project IS NULL OR project = '')
        `).run(t,e),d.customTitle&&this.db.prepare(`
          UPDATE sdk_sessions SET custom_title = ?
          WHERE content_session_id = ? AND custom_title IS NULL
        `).run(d.customTitle,e),d.platformSource){let g=u.platform_source?.trim()?y(u.platform_source):void 0;if(!g)this.db.prepare(`
            UPDATE sdk_sessions SET platform_source = ?
            WHERE content_session_id = ?
              AND COALESCE(platform_source, '') = ''
          `).run(d.platformSource,e);else if(g!==d.platformSource)throw new Error(`Platform source conflict for session ${e}: existing=${g}, received=${d.platformSource}`)}return u.id}return this.db.prepare(`
      INSERT INTO sdk_sessions
      (content_session_id, memory_session_id, project, platform_source, user_prompt, custom_title, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active')
    `).run(e,t,p,s,d.customTitle||null,i.toISOString(),a),this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e).id}saveUserPrompt(e,t,s){let n=new Date,o=n.getTime();return this.db.prepare(`
      INSERT INTO user_prompts
      (content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?)
    `).run(e,t,s,n.toISOString(),o).lastInsertRowid}getUserPrompt(e,t){return this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `).get(e,t)?.prompt_text??null}storeObservation(e,t,s,n,o=0,i,a){let d=i??Date.now(),p=new Date(d).toISOString(),u=q(e,s.title,s.narrative),g=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
       generated_by_model, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_session_id, content_hash) DO NOTHING
      RETURNING id, created_at_epoch
    `).get(e,t,s.type,s.title,s.subtitle,JSON.stringify(s.facts),s.narrative,JSON.stringify(s.concepts),JSON.stringify(s.files_read),JSON.stringify(s.files_modified),n||null,o,s.agent_type??null,s.agent_id??null,u,p,d,a||null,s.metadata??null);if(g)return{id:g.id,createdAtEpoch:g.created_at_epoch};let T=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE memory_session_id = ? AND content_hash = ?").get(e,u);if(!T)throw new Error(`storeObservation: ON CONFLICT without existing row for content_hash=${u}`);return{id:T.id,createdAtEpoch:T.created_at_epoch}}storeSummary(e,t,s,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),u=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.request,s.investigated,s.learned,s.completed,s.next_steps,s.notes,n||null,o,d,a);return{id:Number(u.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,t,s,n,o,i=0,a,d){let p=a??Date.now(),u=new Date(p).toISOString();return this.db.transaction(()=>{let g=[],T=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `),S=this.db.prepare("SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?");for(let l of s){let R=q(e,l.title,l.narrative),h=T.get(e,t,l.type,l.title,l.subtitle,JSON.stringify(l.facts),l.narrative,JSON.stringify(l.concepts),JSON.stringify(l.files_read),JSON.stringify(l.files_modified),o||null,i,l.agent_type??null,l.agent_id??null,R,u,p,d||null);if(h){g.push(h.id);continue}let m=S.get(e,R);if(!m)throw new Error(`storeObservations: ON CONFLICT without existing row for content_hash=${R}`);g.push(m.id)}let b=null;if(n){let R=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,o||null,i,u,p);b=Number(R.lastInsertRowid)}return{observationIds:g,summaryId:b,createdAtEpoch:p}})()}storeObservationsAndMarkComplete(e,t,s,n,o,i,a,d=0,p,u){let E=p??Date.now(),g=new Date(E).toISOString();return this.db.transaction(()=>{let S=[],b=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `),l=this.db.prepare("SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?");for(let m of s){let I=q(e,m.title,m.narrative),U=b.get(e,t,m.type,m.title,m.subtitle,JSON.stringify(m.facts),m.narrative,JSON.stringify(m.concepts),JSON.stringify(m.files_read),JSON.stringify(m.files_modified),a||null,d,m.agent_type??null,m.agent_id??null,I,g,E,u||null);if(U){S.push(U.id);continue}let Oe=l.get(e,I);if(!Oe)throw new Error(`storeObservationsAndMarkComplete: ON CONFLICT without existing row for content_hash=${I}`);S.push(Oe.id)}let R;if(n){let I=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,n.request,n.investigated,n.learned,n.completed,n.next_steps,n.notes,a||null,d,g,E);R=Number(I.lastInsertRowid)}return this.db.prepare(`
        UPDATE pending_messages
        SET
          status = 'processed',
          completed_at_epoch = ?,
          tool_input = NULL,
          tool_response = NULL
        WHERE id = ? AND status = 'processing'
      `).run(E,o),{observationIds:S,summaryId:R,createdAtEpoch:E}})()}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o}=t,i=s==="relevance",a=i?"":`ORDER BY created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,d=n?`LIMIT ${n}`:"",p=e.map(()=>"?").join(","),u=[...e],E=o?`WHERE id IN (${p}) AND project = ?`:`WHERE id IN (${p})`;o&&u.push(o);let T=this.db.prepare(`
      SELECT * FROM session_summaries
      ${E}
      ${a}
      ${d}
    `).all(...u);if(!i)return T;let S=new Map(T.map(b=>[b.id,b]));return e.map(b=>S.get(b)).filter(b=>!!b)}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o}=t,i=s==="relevance",a=i?"":`ORDER BY up.created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,d=n?`LIMIT ${n}`:"",p=e.map(()=>"?").join(","),u=[...e],E=o?"AND s.project = ?":"";o&&u.push(o);let T=this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.id IN (${p}) ${E}
      ${a}
      ${d}
    `).all(...u);if(!i)return T;let S=new Map(T.map(b=>[b.id,b]));return e.map(b=>S.get(b)).filter(b=>!!b)}getTimelineAroundTimestamp(e,t=10,s=10,n){return this.getTimelineAroundObservation(null,e,t,s,n)}getTimelineAroundObservation(e,t,s=10,n=10,o){let i=o?"AND project = ?":"",a=o?[o]:[],d,p;if(e!==null){let l=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id <= ? ${i}
        ORDER BY id DESC
        LIMIT ?
      `,R=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id >= ? ${i}
        ORDER BY id ASC
        LIMIT ?
      `;try{let h=this.db.prepare(l).all(e,...a,s+1),m=this.db.prepare(R).all(e,...a,n+1);if(h.length===0&&m.length===0)return{observations:[],sessions:[],prompts:[]};d=h.length>0?h[h.length-1].created_at_epoch:t,p=m.length>0?m[m.length-1].created_at_epoch:t}catch(h){return h instanceof Error?c.error("DB","Error getting boundary observations",{project:o},h):c.error("DB","Error getting boundary observations with non-Error",{},new Error(String(h))),{observations:[],sessions:[],prompts:[]}}}else{let l=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch <= ? ${i}
        ORDER BY created_at_epoch DESC
        LIMIT ?
      `,R=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch >= ? ${i}
        ORDER BY created_at_epoch ASC
        LIMIT ?
      `;try{let h=this.db.prepare(l).all(t,...a,s),m=this.db.prepare(R).all(t,...a,n+1);if(h.length===0&&m.length===0)return{observations:[],sessions:[],prompts:[]};d=h.length>0?h[h.length-1].created_at_epoch:t,p=m.length>0?m[m.length-1].created_at_epoch:t}catch(h){return h instanceof Error?c.error("DB","Error getting boundary timestamps",{project:o},h):c.error("DB","Error getting boundary timestamps with non-Error",{},new Error(String(h))),{observations:[],sessions:[],prompts:[]}}}let u=`
      SELECT *
      FROM observations
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,E=`
      SELECT *
      FROM session_summaries
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,g=`
      SELECT up.*, s.project, s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${i.replace("project","s.project")}
      ORDER BY up.created_at_epoch ASC
    `,T=this.db.prepare(u).all(d,p,...a),S=this.db.prepare(E).all(d,p,...a),b=this.db.prepare(g).all(d,p,...a);return{observations:T,sessions:S.map(l=>({id:l.id,memory_session_id:l.memory_session_id,project:l.project,request:l.request,completed:l.completed,next_steps:l.next_steps,created_at:l.created_at,created_at_epoch:l.created_at_epoch})),prompts:b.map(l=>({id:l.id,content_session_id:l.content_session_id,prompt_number:l.prompt_number,prompt_text:l.prompt_text,project:l.project,created_at:l.created_at,created_at_epoch:l.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id = ?
      LIMIT 1
    `).get(e)||null}getPromptsByIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id IN (${t})
      ORDER BY p.created_at_epoch DESC
    `).all(...e)}getSessionSummaryById(e){return this.db.prepare(`
      SELECT
        id,
        memory_session_id,
        content_session_id,
        project,
        user_prompt,
        request_summary,
        learned_summary,
        status,
        created_at,
        created_at_epoch
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getOrCreateManualSession(e){let t=`manual-${e}`,s=`manual-content-${e}`;if(this.db.prepare("SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?").get(t))return t;let o=new Date;return this.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, content_session_id, project, platform_source, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(t,s,e,A,o.toISOString(),o.getTime()),c.info("SESSION","Created manual session",{memorySessionId:t,project:e}),t}close(){this.db.close()}importSdkSession(e){let t=this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e.content_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO sdk_sessions (
        content_session_id, memory_session_id, project, platform_source, user_prompt,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.memory_session_id,e.project,y(e.platform_source),e.user_prompt,e.started_at,e.started_at_epoch,e.completed_at,e.completed_at_epoch,e.status).lastInsertRowid}}importSessionSummary(e){let t=this.db.prepare("SELECT id FROM session_summaries WHERE memory_session_id = ?").get(e.memory_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO session_summaries (
        memory_session_id, project, request, investigated, learned,
        completed, next_steps, files_read, files_edited, notes,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.request,e.investigated,e.learned,e.completed,e.next_steps,e.files_read,e.files_edited,e.notes,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}importObservation(e){let t=this.db.prepare(`
      SELECT id FROM observations
      WHERE memory_session_id = ? AND title = ? AND created_at_epoch = ?
    `).get(e.memory_session_id,e.title,e.created_at_epoch);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO observations (
        memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, agent_type, agent_id,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.text,e.type,e.title,e.subtitle,e.facts,e.narrative,e.concepts,e.files_read,e.files_modified,e.prompt_number,e.discovery_tokens||0,e.agent_type??null,e.agent_id??null,e.created_at,e.created_at_epoch).lastInsertRowid}}rebuildObservationsFTSIndex(){this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}importUserPrompt(e){let t=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
    `).get(e.content_session_id,e.prompt_number);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}listProjectsWithOldObservations(e){return this.db.prepare(`
      SELECT DISTINCT project
      FROM observations
      WHERE created_at_epoch < ?
      ORDER BY project ASC
    `).all(e).map(n=>n.project).filter(n=>n!=null)}getObservationsForPeriod(e,t,s,n){return this.db.prepare(`
      SELECT
        id, memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      FROM observations
      WHERE project = ?
        AND created_at_epoch >= ?
        AND created_at_epoch < ?
      ORDER BY created_at_epoch ASC
      LIMIT ?
    `).all(e,t,s,n)}insertObservationDigest(e){let t=new Date;return this.db.prepare(`
      INSERT OR IGNORE INTO observation_digests (
        project, period_start_epoch, period_end_epoch, period_kind, obs_count,
        dominant_types, dominant_concepts, summary_text, facts, files_touched,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.project,e.period_start_epoch,e.period_end_epoch,e.period_kind,e.obs_count,e.dominant_types,e.dominant_concepts,e.summary_text,e.facts,e.files_touched,t.toISOString(),t.getTime()).changes>0}listExistingDigestPeriodStarts(e,t){return this.db.prepare(`
      SELECT period_start_epoch
      FROM observation_digests
      WHERE project = ? AND period_kind = ?
    `).all(e,t).map(o=>o.period_start_epoch)}getOldestObservationEpoch(e){return this.db.prepare(`
      SELECT MIN(created_at_epoch) AS oldest
      FROM observations
      WHERE project = ?
    `).get(e)?.oldest??null}};var C=require("fs"),P=require("path"),_e=require("os"),K=class{static DEFAULTS={CLAUDE_MEM_MODEL:"claude-haiku-4-5-20251001",CLAUDE_MEM_CONTEXT_OBSERVATIONS:"50",CLAUDE_MEM_WORKER_PORT:String(37700+(process.getuid?.()??77)%100),CLAUDE_MEM_WORKER_HOST:"127.0.0.1",CLAUDE_MEM_SKIP_TOOLS:"ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion",CLAUDE_MEM_PREFILTER_ENABLED:"true",CLAUDE_MEM_PREFILTER_BASH_MIN_OUTPUT:"80",CLAUDE_MEM_PREFILTER_READ_MIN_BYTES:"500",CLAUDE_MEM_PREFILTER_MAX_TOTAL_CHARS:"50000",CLAUDE_MEM_PREFILTER_DEDUP_READS:"true",CLAUDE_MEM_DIGEST_ENABLED:"false",CLAUDE_MEM_DIGEST_MIN_AGE_DAYS:"30",CLAUDE_MEM_DIGEST_PERIOD:"weekly",CLAUDE_MEM_DIGEST_MAX_OBS_PER:"100",CLAUDE_MEM_PROVIDER:"claude",CLAUDE_MEM_CLAUDE_AUTH_METHOD:"subscription",CLAUDE_MEM_GEMINI_API_KEY:"",CLAUDE_MEM_GEMINI_MODEL:"gemini-3.1-flash-lite-preview",CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED:"true",CLAUDE_MEM_GEMINI_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_GEMINI_MAX_TOKENS:"100000",CLAUDE_MEM_OPENROUTER_API_KEY:"",CLAUDE_MEM_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",CLAUDE_MEM_OPENROUTER_SITE_URL:"",CLAUDE_MEM_OPENROUTER_APP_NAME:"claude-mem",CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_OPENROUTER_MAX_TOKENS:"100000",CLAUDE_MEM_OLLAMA_BASE_URL:"http://localhost:11434/v1",CLAUDE_MEM_OLLAMA_MODEL:"phi4:14b",CLAUDE_MEM_OLLAMA_NUM_CTX:"32768",CLAUDE_MEM_DEEPSEEK_API_KEY:"",CLAUDE_MEM_DEEPSEEK_MODEL:"deepseek-v4-flash",CLAUDE_MEM_DEEPSEEK_BASE_URL:"https://api.deepseek.com/v1",CLAUDE_MEM_DEEPSEEK_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_DEEPSEEK_MAX_TOKENS:"100000",CLAUDE_MEM_DATA_DIR:(0,P.join)((0,_e.homedir)(),".claude-mem"),CLAUDE_MEM_LOG_LEVEL:"INFO",CLAUDE_MEM_PYTHON_VERSION:"3.13",CLAUDE_CODE_PATH:"",CLAUDE_MEM_MODE:"code",CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT:"true",CLAUDE_MEM_CONTEXT_FULL_COUNT:"0",CLAUDE_MEM_CONTEXT_FULL_FIELD:"narrative",CLAUDE_MEM_CONTEXT_SESSION_COUNT:"10",CLAUDE_MEM_CONTEXT_DIGESTS:"5",CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY:"true",CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE:"false",CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",CLAUDE_MEM_WELCOME_HINT_ENABLED:"true",CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED:"false",CLAUDE_MEM_FOLDER_USE_LOCAL_MD:"false",CLAUDE_MEM_TRANSCRIPTS_ENABLED:"true",CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH:(0,P.join)((0,_e.homedir)(),".claude-mem","transcript-watch.json"),CLAUDE_MEM_MAX_CONCURRENT_AGENTS:"2",CLAUDE_MEM_HOOK_FAIL_LOUD_THRESHOLD:"3",CLAUDE_MEM_EXCLUDED_PROJECTS:"",CLAUDE_MEM_FOLDER_MD_EXCLUDE:"[]",CLAUDE_MEM_SEMANTIC_INJECT:"false",CLAUDE_MEM_SEMANTIC_INJECT_LIMIT:"5",CLAUDE_MEM_TIER_ROUTING_ENABLED:"true",CLAUDE_MEM_TIER_SIMPLE_MODEL:"haiku",CLAUDE_MEM_TIER_SUMMARY_MODEL:"",CLAUDE_MEM_CHROMA_ENABLED:"true",CLAUDE_MEM_CHROMA_MODE:"local",CLAUDE_MEM_CHROMA_HOST:"127.0.0.1",CLAUDE_MEM_CHROMA_PORT:"8000",CLAUDE_MEM_CHROMA_SSL:"false",CLAUDE_MEM_CHROMA_API_KEY:"",CLAUDE_MEM_CHROMA_TENANT:"default_tenant",CLAUDE_MEM_CHROMA_DATABASE:"default_database",CLAUDE_MEM_TELEGRAM_ENABLED:"true",CLAUDE_MEM_TELEGRAM_BOT_TOKEN:"",CLAUDE_MEM_TELEGRAM_CHAT_ID:"",CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES:"security_alert",CLAUDE_MEM_TELEGRAM_TRIGGER_CONCEPTS:""};static getAllDefaults(){return{...this.DEFAULTS}}static get(e){return process.env[e]??this.DEFAULTS[e]}static getInt(e){let t=this.get(e);return parseInt(t,10)}static getBool(e){let t=this.get(e);return t==="true"||t===!0}static applyEnvOverrides(e){let t={...e};for(let s of Object.keys(this.DEFAULTS))process.env[s]!==void 0&&(t[s]=process.env[s]);return t}static loadFromFile(e){try{if(!(0,C.existsSync)(e)){let i=this.getAllDefaults();try{let a=(0,P.dirname)(e);(0,C.existsSync)(a)||(0,C.mkdirSync)(a,{recursive:!0}),(0,C.writeFileSync)(e,JSON.stringify(i,null,2),"utf-8"),console.log("[SETTINGS] Created settings file with defaults:",e)}catch(a){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,a instanceof Error?a.message:String(a))}return this.applyEnvOverrides(i)}let t=(0,C.readFileSync)(e,"utf-8"),s=JSON.parse(t),n=s;if(s.env&&typeof s.env=="object"){n=s.env;try{(0,C.writeFileSync)(e,JSON.stringify(n,null,2),"utf-8"),console.log("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(i){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,i instanceof Error?i.message:String(i))}}let o={...this.DEFAULTS};for(let i of Object.keys(this.DEFAULTS))n[i]!==void 0&&(o[i]=n[i]);return this.applyEnvOverrides(o)}catch(t){return console.warn("[SETTINGS] Failed to load settings, using defaults:",e,t instanceof Error?t.message:String(t)),this.applyEnvOverrides(this.getAllDefaults())}}};var F=require("fs"),V=require("path");var N=class r{static instance=null;activeMode=null;modesDir;constructor(){let e=Me(),t=[(0,V.join)(e,"modes"),(0,V.join)(e,"..","plugin","modes")],s=t.find(n=>(0,F.existsSync)(n));this.modesDir=s||t[0]}static getInstance(){return r.instance||(r.instance=new r),r.instance}parseInheritance(e){let t=e.split("--");if(t.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(t.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:t[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,t){let s={...e};for(let n in t){let o=t[n],i=e[n];this.isPlainObject(o)&&this.isPlainObject(i)?s[n]=this.deepMerge(i,o):s[n]=o}return s}loadModeFile(e){let t=(0,V.join)(this.modesDir,`${e}.json`);if(!(0,F.existsSync)(t))throw new Error(`Mode file not found: ${t}`);let s=(0,F.readFileSync)(t,"utf-8");return JSON.parse(s)}loadMode(e){let t=this.parseInheritance(e);if(!t.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,c.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(p=>p.id),concepts:d.observation_concepts.map(p=>p.id)}),d}catch(d){if(d instanceof Error?c.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{message:d.message}):c.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{error:String(d)}),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:s,overrideId:n}=t,o;try{o=this.loadMode(s)}catch(d){d instanceof Error?c.warn("WORKER",`Parent mode '${s}' not found for ${e}, falling back to 'code'`,{message:d.message}):c.warn("WORKER",`Parent mode '${s}' not found for ${e}, falling back to 'code'`,{error:String(d)}),o=this.loadMode("code")}let i;try{i=this.loadModeFile(n),c.debug("SYSTEM",`Loaded override file: ${n} for parent ${s}`)}catch(d){return d instanceof Error?c.warn("WORKER",`Override file '${n}' not found, using parent mode '${s}' only`,{message:d.message}):c.warn("WORKER",`Override file '${n}' not found, using parent mode '${s}' only`,{error:String(d)}),this.activeMode=o,o}if(!i)return c.warn("SYSTEM",`Invalid override file: ${n}, using parent mode '${s}' only`),this.activeMode=o,o;let a=this.deepMerge(o,i);return this.activeMode=a,c.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${s} + ${n})`,void 0,{parent:s,override:n,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getObservationConcepts(){return this.getActiveMode().observation_concepts}getTypeIcon(e){return this.getObservationTypes().find(s=>s.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(s=>s.id===e)?.work_emoji||"\u{1F4DD}"}validateType(e){return this.getObservationTypes().some(t=>t.id===e)}getTypeLabel(e){return this.getObservationTypes().find(s=>s.id===e)?.label||e}};function ce(){let r=x.settings(),e=K.loadFromFile(r),t=N.getInstance().getActiveMode(),s=new Set(t.observation_types.map(o=>o.id)),n=new Set(t.observation_concepts.map(o=>o.id));return{totalObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.CLAUDE_MEM_CONTEXT_SESSION_COUNT,10),digestCount:parseInt(e.CLAUDE_MEM_CONTEXT_DIGESTS,10),showReadTokens:e.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:s,observationConcepts:n,fullObservationField:e.CLAUDE_MEM_CONTEXT_FULL_FIELD,showLastSummary:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE==="true"}}var _={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},Pe=4,ue=1;function pe(r){let e=(r.title?.length||0)+(r.subtitle?.length||0)+(r.narrative?.length||0)+JSON.stringify(r.facts||[]).length;return Math.ceil(e/Pe)}function me(r){let e=r.length,t=r.reduce((i,a)=>i+pe(a),0),s=r.reduce((i,a)=>i+(a.discovery_tokens||0),0),n=s-t,o=s>0?Math.round(n/s*100):0;return{totalObservations:e,totalReadTokens:t,totalDiscoveryTokens:s,savings:n,savingsPercent:o}}function es(r){return N.getInstance().getWorkEmoji(r)}function $(r,e){let t=pe(r),s=r.discovery_tokens||0,n=es(r.type),o=s>0?`${n} ${s.toLocaleString()}`:"-";return{readTokens:t,discoveryTokens:s,discoveryDisplay:o,workEmoji:n}}function J(r){return r.showReadTokens||r.showWorkTokens||r.showSavingsAmount||r.showSavingsPercent}var $e=M(require("path"),1),Q=require("fs");var ts=["private","claude-mem-context","system_instruction","system-instruction","persisted-output","system-reminder"],ir=new RegExp(`<(${ts.join("|")})\\b[^>]*>[\\s\\S]*?</\\1>`,"g"),Fe=/<system-reminder>[\s\S]*?<\/system-reminder>/g;var ss=["task-notification"],ar=new RegExp(`^\\s*<(${ss.join("|")})\\b[^>]*>(?:(?!<\\1\\b|</\\1\\b)[\\s\\S])*</\\1>\\s*$`),dr=256*1024;function le(r,e,t){let s=Array.from(t.observationTypes),n=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      o.id,
      o.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      o.type,
      o.title,
      o.subtitle,
      o.narrative,
      o.facts,
      o.concepts,
      o.files_read,
      o.files_modified,
      o.discovery_tokens,
      o.created_at,
      o.created_at_epoch
    FROM observations o
    LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    WHERE (o.project = ? OR o.merged_into_project = ?)
      AND type IN (${n})
      AND EXISTS (
        SELECT 1 FROM json_each(o.concepts)
        WHERE value IN (${i})
      )
    ORDER BY o.created_at_epoch DESC
    LIMIT ?
  `).all(e,e,...s,...o,t.totalObservationCount)}function Ee(r,e,t){return r.db.prepare(`
    SELECT
      ss.id,
      ss.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      ss.request,
      ss.investigated,
      ss.learned,
      ss.completed,
      ss.next_steps,
      ss.created_at,
      ss.created_at_epoch
    FROM session_summaries ss
    LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    WHERE (ss.project = ? OR ss.merged_into_project = ?)
    ORDER BY ss.created_at_epoch DESC
    LIMIT ?
  `).all(e,e,t.sessionCount+ue)}function Ge(r,e,t){let s=Array.from(t.observationTypes),n=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(","),a=e.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      o.id,
      o.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      o.type,
      o.title,
      o.subtitle,
      o.narrative,
      o.facts,
      o.concepts,
      o.files_read,
      o.files_modified,
      o.discovery_tokens,
      o.created_at,
      o.created_at_epoch,
      o.project
    FROM observations o
    LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    WHERE (o.project IN (${a})
           OR o.merged_into_project IN (${a}))
      AND type IN (${n})
      AND EXISTS (
        SELECT 1 FROM json_each(o.concepts)
        WHERE value IN (${i})
      )
    ORDER BY o.created_at_epoch DESC
    LIMIT ?
  `).all(...e,...e,...s,...o,t.totalObservationCount)}function He(r,e,t){let s=e.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      ss.id,
      ss.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      ss.request,
      ss.investigated,
      ss.learned,
      ss.completed,
      ss.next_steps,
      ss.created_at,
      ss.created_at_epoch,
      ss.project
    FROM session_summaries ss
    LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    WHERE (ss.project IN (${s})
           OR ss.merged_into_project IN (${s}))
    ORDER BY ss.created_at_epoch DESC
    LIMIT ?
  `).all(...e,...e,t.sessionCount+ue)}function Xe(r,e,t){return t.digestCount<=0?[]:r.db.prepare(`
    SELECT
      id,
      project,
      period_start_epoch,
      period_end_epoch,
      period_kind,
      obs_count,
      dominant_types,
      dominant_concepts,
      summary_text,
      facts,
      files_touched,
      created_at,
      created_at_epoch
    FROM observation_digests
    WHERE project = ?
    ORDER BY period_start_epoch DESC
    LIMIT ?
  `).all(e,t.digestCount)}function je(r,e,t){if(t.digestCount<=0)return[];if(e.length===0)return[];let s=e.map(()=>"?").join(",");return r.db.prepare(`
    SELECT
      id,
      project,
      period_start_epoch,
      period_end_epoch,
      period_kind,
      obs_count,
      dominant_types,
      dominant_concepts,
      summary_text,
      facts,
      files_touched,
      created_at,
      created_at_epoch
    FROM observation_digests
    WHERE project IN (${s})
    ORDER BY period_start_epoch DESC
    LIMIT ?
  `).all(...e,t.digestCount)}function rs(r){return r.replace(/\//g,"-")}function ns(r){if(!r.includes('"type":"assistant"'))return null;let e=JSON.parse(r);if(e.type==="assistant"&&e.message?.content&&Array.isArray(e.message.content)){let t="";for(let s of e.message.content)s.type==="text"&&(t+=s.text);if(t=t.replace(Fe,"").trim(),t)return t}return null}function os(r){for(let e=r.length-1;e>=0;e--)try{let t=ns(r[e]);if(t)return t}catch(t){t instanceof Error?c.debug("WORKER","Skipping malformed transcript line",{lineIndex:e},t):c.debug("WORKER","Skipping malformed transcript line",{lineIndex:e,error:String(t)});continue}return""}function is(r){try{if(!(0,Q.existsSync)(r))return{userMessage:"",assistantMessage:""};let e=(0,Q.readFileSync)(r,"utf-8").trim();if(!e)return{userMessage:"",assistantMessage:""};let t=e.split(`
`).filter(n=>n.trim());return{userMessage:"",assistantMessage:os(t)}}catch(e){return e instanceof Error?c.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r},e):c.warn("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r,error:String(e)}),{userMessage:"",assistantMessage:""}}}function ge(r,e,t,s){if(!e.showLastMessage||r.length===0)return{userMessage:"",assistantMessage:""};let n=r.find(d=>d.memory_session_id!==t);if(!n)return{userMessage:"",assistantMessage:""};let o=n.memory_session_id,i=rs(s),a=$e.default.join(v,"projects",i,`${o}.jsonl`);return is(a)}function Be(r,e){let t=e[0]?.id;return r.map((s,n)=>{let o=n===0?null:e[n+1];return{...s,displayEpoch:o?o.created_at_epoch:s.created_at_epoch,displayTime:o?o.created_at:s.created_at,shouldShowLink:s.id!==t}})}function Te(r,e){let t=[...r.map(s=>({type:"observation",data:s})),...e.map(s=>({type:"summary",data:s}))];return t.sort((s,n)=>{let o=s.type==="observation"?s.data.created_at_epoch:s.data.displayEpoch,i=n.type==="observation"?n.data.created_at_epoch:n.data.displayEpoch;return o-i}),t}function We(r,e){return new Set(r.slice(0,e).map(t=>t.id))}function qe(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function Ye(r){return[`# [${r}] recent context, ${qe()}`,""]}function Ke(){return[`Legend: \u{1F3AF}session ${N.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji}${t.id}`).join(" ")}`,"Format: ID TIME TYPE TITLE","Fetch details: get_observations([IDs]) | Search: mem-search skill",""]}function Ve(){return[]}function Je(){return[]}function Qe(r,e){let t=[],s=[`${r.totalObservations} obs (${r.totalReadTokens.toLocaleString()}t read)`,`${r.totalDiscoveryTokens.toLocaleString()}t work`];return r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)&&(e.showSavingsPercent?s.push(`${r.savingsPercent}% savings`):e.showSavingsAmount&&s.push(`${r.savings.toLocaleString()}t saved`)),t.push(`Stats: ${s.join(" | ")}`),t.push(""),t}function ze(r){return[`### ${r}`]}function Ze(r){return r.toLowerCase().replace(" am","a").replace(" pm","p")}function et(r,e,t){let s=r.title||"Untitled",n=N.getInstance().getTypeIcon(r.type),o=e?Ze(e):'"';return`${r.id} ${o} ${n} ${s}`}function tt(r,e,t,s){let n=[],o=r.title||"Untitled",i=N.getInstance().getTypeIcon(r.type),a=e?Ze(e):'"',{readTokens:d,discoveryDisplay:p}=$(r,s);n.push(`**${r.id}** ${a} ${i} **${o}**`),t&&n.push(t);let u=[];return s.showReadTokens&&u.push(`~${d}t`),s.showWorkTokens&&u.push(p),u.length>0&&n.push(u.join(" ")),n.push(""),n}function st(r,e){return[`S${r.id} ${r.request||"Session started"} (${e})`]}function G(r,e){return e?[`**${r}**: ${e}`,""]:[]}function rt(r){return r.assistantMessage?["","---","","**Previously**","",`A: ${r.assistantMessage}`,""]:[]}function nt(r,e){return["",`Access ${Math.round(r/1e3)}k tokens of past work via get_observations([IDs]) or mem-search skill.`]}function ot(r){return`# [${r}] recent context, ${qe()}

No previous sessions found.`}function it(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function at(r){return["",`${_.bright}${_.cyan}[${r}] recent context, ${it()}${_.reset}`,`${_.gray}${"\u2500".repeat(60)}${_.reset}`,""]}function dt(){let e=N.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ");return[`${_.dim}Legend: session-request | ${e}${_.reset}`,""]}function _t(){return[`${_.bright}Column Key${_.reset}`,`${_.dim}  Read: Tokens to read this observation (cost to learn it now)${_.reset}`,`${_.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${_.reset}`,""]}function ct(){return[`${_.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${_.reset}`,"",`${_.dim}When you need implementation details, rationale, or debugging context:${_.reset}`,`${_.dim}  - Fetch by ID: get_observations([IDs]) for observations visible in this index${_.reset}`,`${_.dim}  - Search history: Use the mem-search skill for past decisions, bugs, and deeper research${_.reset}`,`${_.dim}  - Trust this index over re-reading code for past decisions and learnings${_.reset}`,""]}function ut(r,e){let t=[];if(t.push(`${_.bright}${_.cyan}Context Economics${_.reset}`),t.push(`${_.dim}  Loading: ${r.totalObservations} observations (${r.totalReadTokens.toLocaleString()} tokens to read)${_.reset}`),t.push(`${_.dim}  Work investment: ${r.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${_.reset}`),r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let s="  Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?s+=`${r.savings.toLocaleString()} tokens (${r.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?s+=`${r.savings.toLocaleString()} tokens`:s+=`${r.savingsPercent}% reduction from reuse`,t.push(`${_.green}${s}${_.reset}`)}return t.push(""),t}function pt(r){return[`${_.bright}${_.cyan}${r}${_.reset}`,""]}function mt(r){return[`${_.dim}${r}${_.reset}`]}function lt(r,e,t,s){let n=r.title||"Untitled",o=N.getInstance().getTypeIcon(r.type),{readTokens:i,discoveryTokens:a,workEmoji:d}=$(r,s),p=t?`${_.dim}${e}${_.reset}`:" ".repeat(e.length),u=s.showReadTokens&&i>0?`${_.dim}(~${i}t)${_.reset}`:"",E=s.showWorkTokens&&a>0?`${_.dim}(${d} ${a.toLocaleString()}t)${_.reset}`:"";return`  ${_.dim}#${r.id}${_.reset}  ${p}  ${o}  ${n} ${u} ${E}`}function Et(r,e,t,s,n){let o=[],i=r.title||"Untitled",a=N.getInstance().getTypeIcon(r.type),{readTokens:d,discoveryTokens:p,workEmoji:u}=$(r,n),E=t?`${_.dim}${e}${_.reset}`:" ".repeat(e.length),g=n.showReadTokens&&d>0?`${_.dim}(~${d}t)${_.reset}`:"",T=n.showWorkTokens&&p>0?`${_.dim}(${u} ${p.toLocaleString()}t)${_.reset}`:"";return o.push(`  ${_.dim}#${r.id}${_.reset}  ${E}  ${a}  ${_.bright}${i}${_.reset}`),s&&o.push(`    ${_.dim}${s}${_.reset}`),(g||T)&&o.push(`    ${g} ${T}`),o.push(""),o}function gt(r,e){let t=`${r.request||"Session started"} (${e})`;return[`${_.yellow}#S${r.id}${_.reset} ${t}`,""]}function H(r,e,t){return e?[`${t}${r}:${_.reset} ${e}`,""]:[]}function Tt(r){return r.assistantMessage?["","---","",`${_.bright}${_.magenta}Previously${_.reset}`,"",`${_.dim}A: ${r.assistantMessage}${_.reset}`,""]:[]}function ft(r,e){let t=Math.round(r/1e3);return["",`${_.dim}Access ${t}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use the claude-mem skill to access memories by ID.${_.reset}`]}function St(r){return`
${_.bright}${_.cyan}[${r}] recent context, ${it()}${_.reset}
${_.gray}${"\u2500".repeat(60)}${_.reset}

${_.dim}No previous sessions found for this project yet.${_.reset}
`}function bt(r,e,t,s){let n=[];return s?n.push(...at(r)):n.push(...Ye(r)),s?n.push(...dt()):n.push(...Ke()),s?n.push(..._t()):n.push(...Ve()),s?n.push(...ct()):n.push(...Je()),J(t)&&(s?n.push(...ut(e,t)):n.push(...Qe(e,t))),n}var fe=M(require("path"),1);function ee(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[]}catch(e){return c.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:r?.substring(0,50)},e instanceof Error?e:new Error(String(e))),[]}}function Se(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function be(r){return new Date(r).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function Ot(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function ht(r,e){return fe.default.isAbsolute(r)?fe.default.relative(e,r):r}function Rt(r,e,t){let s=ee(r);if(s.length>0)return ht(s[0],e);if(t){let n=ee(t);if(n.length>0)return ht(n[0],e)}return"General"}function as(r){let e=new Map;for(let s of r){let n=s.type==="observation"?s.data.created_at:s.data.displayTime,o=Ot(n);e.has(o)||e.set(o,[]),e.get(o).push(s)}let t=Array.from(e.entries()).sort((s,n)=>{let o=new Date(s[0]).getTime(),i=new Date(n[0]).getTime();return o-i});return new Map(t)}function At(r,e){return e.fullObservationField==="narrative"?r.narrative:r.facts?ee(r.facts).join(`
`):null}function ds(r,e,t,s){let n=[];n.push(...ze(r));let o="";for(let i of e)if(i.type==="summary"){let a=i.data,d=Se(a.displayTime);n.push(...st(a,d))}else{let a=i.data,d=be(a.created_at),u=d!==o?d:"";if(o=d,t.has(a.id)){let g=At(a,s);n.push(...tt(a,u,g,s))}else n.push(et(a,u,s))}return n}function _s(r,e,t,s,n){let o=[];o.push(...pt(r));let i=null,a="";for(let d of e)if(d.type==="summary"){i=null,a="";let p=d.data,u=Se(p.displayTime);o.push(...gt(p,u))}else{let p=d.data,u=Rt(p.files_modified,n,p.files_read),E=be(p.created_at),g=E!==a;a=E;let T=t.has(p.id);if(u!==i&&(o.push(...mt(u)),i=u),T){let S=At(p,s);o.push(...Et(p,E,g,S,s))}else o.push(lt(p,E,g,s))}return o.push(""),o}function cs(r,e,t,s,n,o){return o?_s(r,e,t,s,n):ds(r,e,t,s)}function Nt(r,e,t,s,n){let o=[],i=as(r);for(let[a,d]of i)o.push(...cs(a,d,e,t,s,n));return o}function Ct(r,e,t){return!(!r.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||t&&e.created_at_epoch<=t.created_at_epoch)}function It(r,e){let t=[];return e?(t.push(...H("Investigated",r.investigated,_.blue)),t.push(...H("Learned",r.learned,_.yellow)),t.push(...H("Completed",r.completed,_.green)),t.push(...H("Next Steps",r.next_steps,_.magenta))):(t.push(...G("Investigated",r.investigated)),t.push(...G("Learned",r.learned)),t.push(...G("Completed",r.completed)),t.push(...G("Next Steps",r.next_steps))),t}function Lt(r,e){return e?Tt(r):rt(r)}function Mt(r,e,t){return!J(e)||r.totalDiscoveryTokens<=0||r.savings<=0?[]:t?ft(r.totalDiscoveryTokens,r.totalReadTokens):nt(r.totalDiscoveryTokens,r.totalReadTokens)}function us(r){let e=new Date(r);if(Number.isNaN(e.getTime()))return"";let t=e.getUTCFullYear().toString().padStart(4,"0"),s=(e.getUTCMonth()+1).toString().padStart(2,"0"),n=e.getUTCDate().toString().padStart(2,"0");return`${t}-${s}-${n}`}function ps(r){if(!r)return"";let e=r.replace(/\s+/g," ").trim();return e.length<=200?e:e.slice(0,200).replace(/[#*`\-_\[\(\s]+$/,"").trimEnd()}function ms(r){if(r.length===0)return"";let e=r[0].period_kind;return r.every(s=>s.period_kind===e)?e:"mixed"}function Dt(r){if(r.length===0)return[];let e=ms(r),t=[];t.push(`## Historical context (${r.length} ${e} digests)`);for(let s=r.length-1;s>=0;s--){let n=r[s],o=us(n.period_start_epoch),i=n.project??"",a=ps(n.summary_text),d=o?`${n.period_kind} ${o} \xB7 ${i} \xB7 ${n.obs_count} obs`:`${n.period_kind} ${i} \xB7 ${n.obs_count} obs`;t.push(a?`- ${d}: ${a}`:`- ${d}`)}return t.push(""),t}var ls=vt.default.join((0,yt.homedir)(),".claude","plugins","marketplaces","thedotmack","plugin",".install-version");function Es(){try{return new Y}catch(r){if(r instanceof Error&&r.code==="ERR_DLOPEN_FAILED"){try{(0,Ut.unlinkSync)(ls)}catch(e){e instanceof Error?c.debug("WORKER","Marker file cleanup failed (may not exist)",{},e):c.debug("WORKER","Marker file cleanup failed (may not exist)",{error:String(e)})}return c.error("WORKER","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw r}}function gs(r,e){return e?St(r):ot(r)}function Ts(r,e,t,s,n,o,i,a){let d=[],p=me(e);d.push(...bt(r,p,n,a)),d.push(...Dt(s));let u=t.slice(0,n.sessionCount),E=Be(u,t),g=Te(e,E),T=We(e,n.fullObservationCount);d.push(...Nt(g,T,n,o,a));let S=t[0],b=e[0];Ct(n,S,b)&&d.push(...It(S,a));let l=ge(e,n,i,o);return d.push(...Lt(l,a)),d.push(...Mt(p,n,a)),d.join(`
`).trimEnd()}async function he(r,e=!1){let t=ce(),s=r?.cwd??process.cwd(),n=ie(s),o=r?.projects?.length?r.projects:n.allProjects,i=o[o.length-1]??n.primary;r?.full&&(t.totalObservationCount=999999,t.sessionCount=999999);let a=Es();if(!a)return"";try{let d=o.length>1?Ge(a,o,t):le(a,i,t),p=o.length>1?He(a,o,t):Ee(a,i,t),u=o.length>1?je(a,o,t):Xe(a,i,t);return d.length===0&&p.length===0&&u.length===0?gs(i,e):Ts(i,d,p,u,t,s,r?.session_id,e)}finally{a.close()}}0&&(module.exports={generateContext});
