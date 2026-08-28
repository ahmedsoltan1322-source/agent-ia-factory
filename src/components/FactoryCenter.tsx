import { useMemo, useState } from 'react'
import {
  installFactoryBlueprint,
  loadFactoryAudit,
  loadFactoryBlueprints,
  planAgentFactory,
  previewFactoryInstall,
  type FactoryBlueprint,
} from '../core/factoryPlanner'
import type { AgentSpec, RuntimeAdapterId } from '../core/types'

interface Props {
  onAgentsChange: (agents: AgentSpec[]) => void
  onNotice: (message: string) => void
  localAiReady: boolean
}

function friendlyFactoryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    FACTORY_GOAL_REQUIRED: 'اكتب Goal (الهدف) الذي تريد من المصنع بناء فريق لأجله.',
    FACTORY_RUNTIME_FORBIDDEN: 'محرك التشغيل المطلوب غير مسموح في Factory (المصنع) المجاني الحالي.',
    FACTORY_HUMAN_APPROVAL_REQUIRED: 'يجب أن تمنح موافقة بشرية صريحة قبل إنشاء الفريق.',
    FACTORY_BLUEPRINT_ALREADY_INSTALLED: 'هذا Blueprint (المخطط) تم تثبيته سابقاً. أنشئ مخططاً جديداً إذا أردت فريقاً آخر.',
  }
  return labels[message] ?? `Agent Factory (مصنع الوكلاء): ${message}`
}

export default function FactoryCenter({ onAgentsChange, onNotice, localAiReady }: Props) {
  const [goal, setGoal] = useState('أنشئ لي فريق وكلاء يساعدني على بناء مشروع برمجي، يخطط وينفذ ويختبر ويراجع الأمن قبل التسليم.')
  const [runtime, setRuntime] = useState<RuntimeAdapterId>('local-demo')
  const [blueprint, setBlueprint] = useState<FactoryBlueprint | null>(() => loadFactoryBlueprints()[0] ?? null)
  const [approved, setApproved] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [auditRevision, setAuditRevision] = useState(0)

  const preview = useMemo(() => {
    if (!blueprint || blueprint.status === 'installed') return null
    try {
      return previewFactoryInstall(blueprint)
    } catch {
      return null
    }
  }, [blueprint])

  const recentAudit = useMemo(() => {
    void auditRevision
    return loadFactoryAudit().slice(0, 6)
  }, [auditRevision])

  function handleAnalyze() {
    try {
      const planned = planAgentFactory(goal, runtime)
      setBlueprint(planned)
      setApproved(false)
      setAuditRevision((value) => value + 1)
      onNotice(`تم تحليل الهدف محلياً. اقترح Agent Factory فريقاً من ${planned.roles.length} Agents (وكلاء) في مجال: ${planned.domainLabel}. لم يُنشأ أي وكيل بعد.`)
    } catch (error) {
      onNotice(friendlyFactoryError(error))
    }
  }

  function handleInstall() {
    if (!blueprint) return
    if (runtime === 'local-qwen-webgpu' && !localAiReady) {
      onNotice('Blueprint يستخدم Qwen Local AI (الذكاء المحلي)، لكن النموذج غير محمّل بعد. يمكنك تثبيت الفريق الآن، لكن تشغيله لن ينجح حتى تنزل النموذج، أو أعد التحليل واختر Local Demo.')
    }
    setInstalling(true)
    try {
      const result = installFactoryBlueprint(blueprint, approved)
      setBlueprint(result.blueprint)
      onAgentsChange(result.allAgents)
      window.dispatchEvent(new CustomEvent('agentia:workflows-updated', { detail: { workflowId: result.workflow.id } }))
      setAuditRevision((value) => value + 1)
      setApproved(false)
      onNotice(`تم إنشاء الفريق فعلياً: ${result.agents.length} Agents (وكلاء) + Workflow (سير عمل) محفوظ. لم يبدأ أي تشغيل تلقائياً؛ انتقل إلى Team Workflow وشغله عندما تريد.`)
    } catch (error) {
      setAuditRevision((value) => value + 1)
      onNotice(friendlyFactoryError(error))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <section className="card factory-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 5 — Agent Factory (مصنع الوكلاء)</p>
          <h2>اكتب الهدف، والمصنع يصمم الفريق</h2>
        </div>
        <span className="safe-pill">Plan → Review → Install</span>
      </div>

      <p className="disclaimer">
        Planner (المخطط) في هذه النسخة حتمي ومحلي: لا يرسل هدفك إلى API، ولا يشغّل Agent أو Tool، ولا يمنح صلاحيات. أولاً يعطيك Blueprint (مخططاً) قابلًا للمراجعة؛ إنشاء الفريق يحتاج موافقتك الصريحة.
      </p>

      <div className="factory-input-grid">
        <label>
          Goal (الهدف)
          <textarea rows={5} maxLength={6000} value={goal} onChange={(event) => setGoal(event.target.value)} />
        </label>
        <label>
          Runtime (محرك التشغيل المقترح لكل الفريق)
          <select value={runtime} onChange={(event) => setRuntime(event.target.value as RuntimeAdapterId)}>
            <option value="local-demo">Local Demo (تجريبي محلي) — أخف، بلا تنزيل</option>
            <option value="local-qwen-webgpu">Qwen3 Local AI (ذكاء محلي) — {localAiReady ? 'جاهز الآن' : 'يحتاج تنزيل النموذج'}</option>
          </select>
        </label>
        <button className="primary-button" type="button" disabled={!goal.trim()} onClick={handleAnalyze}>
          ✦ Analyze & Build Blueprint (تحليل وبناء المخطط)
        </button>
      </div>

      {blueprint && (
        <div className="factory-blueprint">
          <div className="factory-blueprint-head">
            <div>
              <span className="local-pill">{blueprint.status === 'installed' ? 'Installed (مثبّت)' : 'Validated (صالح)'}</span>
              <h3>{blueprint.teamName}</h3>
              <p>{blueprint.domainLabel} · {blueprint.roles.length} Agents · Runtime: {blueprint.runtimeAdapter}</p>
            </div>
            <div className="cost-badge small-cost"><span>Mandatory Spend</span><strong>$0</strong></div>
          </div>

          <div className="factory-policy-grid">
            <div><span>Paid Models</span><strong>ممنوعة</strong></div>
            <div><span>Auto Tools</span><strong>لا</strong></div>
            <div><span>Auto Run</span><strong>لا</strong></div>
            <div><span>Install Approval</span><strong>إلزامية</strong></div>
          </div>

          <div className="factory-role-list">
            {blueprint.roles.map((role, index) => (
              <article className="factory-role" key={role.id}>
                <div className="factory-role-title">
                  <span>{index + 1}</span>
                  <div><strong>{role.name}</strong><small>{role.purpose}</small></div>
                </div>
                <details>
                  <summary>Instructions (تعليمات الوكيل)</summary>
                  <pre>{role.instructions}</pre>
                </details>
                <details>
                  <summary>Suggested Tools (أدوات مقترحة فقط)</summary>
                  {role.suggestedToolIds.length === 0
                    ? <p>لا توجد اقتراحات.</p>
                    : <ul>{role.suggestedToolIds.map((tool) => <li key={tool}>{tool} — غير مفعّلة تلقائياً</li>)}</ul>}
                </details>
              </article>
            ))}
          </div>

          <div className="factory-tests">
            <strong>Acceptance Tests (اختبارات القبول)</strong>
            {blueprint.acceptanceTests.map((test) => (
              <label className="factory-test" key={test.id}>
                <span>✓</span>
                <span><strong>{test.title}</strong><small>{test.description}</small></span>
              </label>
            ))}
          </div>

          {preview && (
            <div className="factory-preview">
              <strong>Pre-Install Validation (فحص ما قبل التثبيت)</strong>
              <span>{preview.agents.length} Agent Specs (مواصفات وكلاء) جاهزة</span>
              <span>{preview.workflow.nodes.length} Workflow Nodes (عقد سير العمل)</span>
              <span>Tool allowlists: فارغة</span>
              <span>Automatic run: لا</span>
            </div>
          )}

          {blueprint.status !== 'installed' ? (
            <div className="factory-approval">
              <label className="workflow-check">
                <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
                أوافق على إنشاء هؤلاء Agents (الوكلاء) وهذا Workflow (سير العمل) محلياً. أفهم أن الأدوات لن تُفعّل وأن الفريق لن يبدأ التشغيل تلقائياً.
              </label>
              <button className="run-button" type="button" disabled={!approved || installing} onClick={handleInstall}>
                {installing ? 'جاري إنشاء الفريق...' : '✓ Approve & Build Team (موافقة وإنشاء الفريق)'}
              </button>
            </div>
          ) : (
            <div className="factory-installed-note">
              <strong>✓ تم إنشاء هذا الفريق.</strong>
              <p>الخطوة التالية اختيار Workflow من Team Workflow (سير عمل الفريق) وتشغيله يدوياً. لا يوجد Run تلقائي.</p>
            </div>
          )}
        </div>
      )}

      <details className="factory-audit">
        <summary>Factory Audit (سجل المصنع المحلي)</summary>
        {recentAudit.length === 0 ? <p>لا توجد سجلات بعد.</p> : (
          <div className="factory-audit-list">
            {recentAudit.map((record) => (
              <div key={record.id}>
                <strong>{record.action}</strong>
                <span>{new Date(record.createdAt).toLocaleString('ar')}</span>
                <span>cost=${record.monetaryCostUsd.toFixed(2)}</span>
                {record.error && <small>{record.error}</small>}
              </div>
            ))}
          </div>
        )}
      </details>
    </section>
  )
}
