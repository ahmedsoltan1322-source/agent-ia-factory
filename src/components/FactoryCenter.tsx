import { useMemo, useState } from 'react'
import FactoryIntelligenceCenter from './FactoryIntelligenceCenter'
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

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    FACTORY_GOAL_REQUIRED: 'اكتب Goal (الهدف) أولاً.',
    FACTORY_RUNTIME_FORBIDDEN: 'Runtime (محرك التشغيل) غير مسموح في Factory المجاني الحالي.',
    FACTORY_HUMAN_APPROVAL_REQUIRED: 'يلزم Human Approval (موافقة بشرية) صريحة قبل إنشاء الفريق.',
    FACTORY_BLUEPRINT_ALREADY_INSTALLED: 'هذا Blueprint (المخطط) تم تثبيته سابقاً.',
  }
  return labels[message] ?? `Agent Factory (مصنع الوكلاء): ${message}`
}

export default function FactoryCenter({ onAgentsChange, onNotice, localAiReady }: Props) {
  const [goal, setGoal] = useState('أنشئ لي فريق وكلاء يخطط للمشروع، ينفذ، يختبر، ثم يراجع الجودة والأمان قبل التسليم.')
  const [runtime, setRuntime] = useState<RuntimeAdapterId>('local-demo')
  const [blueprint, setBlueprint] = useState<FactoryBlueprint | null>(() => loadFactoryBlueprints()[0] ?? null)
  const [approved, setApproved] = useState(false)
  const [revision, setRevision] = useState(0)

  const preview = useMemo(() => {
    if (!blueprint || blueprint.status === 'installed') return null
    try {
      return previewFactoryInstall(blueprint)
    } catch {
      return null
    }
  }, [blueprint])

  const recentAudit = useMemo(() => {
    void revision
    return loadFactoryAudit().slice(0, 6)
  }, [revision])

  function analyze() {
    try {
      const next = planAgentFactory(goal, runtime)
      setBlueprint(next)
      setApproved(false)
      setRevision((value) => value + 1)
      onNotice(`تم تحليل الهدف محلياً. Blueprint (المخطط) يقترح ${next.roles.length} Agents (وكلاء) في مجال ${next.domainLabel}. لم يُنشأ أو يُشغّل أي وكيل بعد.`)
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function install() {
    if (!blueprint) return
    if (runtime === 'local-qwen-webgpu' && !localAiReady) {
      onNotice('الفريق سيستعمل Qwen Local AI، لكن النموذج غير محمّل الآن. التثبيت مسموح، أما التشغيل فلن يبدأ تلقائياً ولن ينجح حتى تحميل النموذج.')
    }
    try {
      const result = installFactoryBlueprint(blueprint, approved)
      setBlueprint(result.blueprint)
      onAgentsChange(result.allAgents)
      setApproved(false)
      setRevision((value) => value + 1)
      window.dispatchEvent(new CustomEvent('agentia:workflows-updated', { detail: { workflowId: result.workflow.id } }))
      onNotice(`تم إنشاء ${result.agents.length} Agents + Workflow محفوظ بأمان. لم يبدأ Run (تشغيل) ولم تُفعّل أي Tool/MCP تلقائياً.`)
    } catch (error) {
      setRevision((value) => value + 1)
      onNotice(friendlyError(error))
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
        Factory Planner (مخطط المصنع) حتمي ومحلي في هذه المرحلة: لا يرسل هدفك إلى API، ولا يشغّل Agent أو Tool، ولا يمنح صلاحيات. أولاً يبني Blueprint (مخططاً) للمراجعة، ثم يحتاج موافقتك الصريحة للتثبيت.
      </p>

      <div className="factory-input-grid">
        <label>
          Goal (الهدف)
          <textarea rows={5} maxLength={6000} value={goal} onChange={(event) => setGoal(event.target.value)} />
        </label>
        <label>
          Runtime (محرك التشغيل المقترح)
          <select value={runtime} onChange={(event) => setRuntime(event.target.value as RuntimeAdapterId)}>
            <option value="local-demo">Local Demo — أخف، بلا تنزيل</option>
            <option value="local-qwen-webgpu">Qwen3 Local AI — {localAiReady ? 'جاهز' : 'يحتاج تنزيل النموذج'}</option>
          </select>
        </label>
        <button className="primary-button" type="button" disabled={!goal.trim()} onClick={analyze}>
          ✦ Analyze & Build Blueprint (تحليل وبناء المخطط)
        </button>
      </div>

      {blueprint && (
        <div className="factory-blueprint">
          <div className="factory-blueprint-head">
            <div>
              <span className={blueprint.status === 'installed' ? 'safe-pill' : 'local-pill'}>
                {blueprint.status === 'installed' ? 'Installed (مثبّت)' : 'Validated (صالح للمراجعة)'}
              </span>
              <h3>{blueprint.teamName}</h3>
              <small>{blueprint.domainLabel} · {blueprint.roles.length} Agents · Mandatory spend $0</small>
            </div>
          </div>

          <div className="factory-policy-grid">
            <div><span>Paid Models</span><strong>ممنوعة</strong></div>
            <div><span>Suggested Tools</span><strong>اقتراح فقط</strong></div>
            <div><span>Auto Tool Enable</span><strong>ممنوع</strong></div>
            <div><span>Auto Run</span><strong>ممنوع</strong></div>
            <div><span>Install Approval</span><strong>إلزامي</strong></div>
            <div><span>Workflow Handoffs</span><strong>Approval بين الوكلاء</strong></div>
          </div>

          <h4>Roles (الأدوار)</h4>
          <div className="factory-role-list">
            {blueprint.roles.map((role, index) => (
              <article className="factory-role" key={role.id}>
                <div className="factory-role-number">{index + 1}</div>
                <div>
                  <strong>{role.name}</strong>
                  <p>{role.purpose}</p>
                  <details>
                    <summary>Instructions & suggested tools (التعليمات والأدوات المقترحة)</summary>
                    <pre>{role.instructions}</pre>
                    <small>Tools: {role.suggestedToolIds.length ? role.suggestedToolIds.join(' · ') : 'لا شيء'}</small>
                  </details>
                </div>
              </article>
            ))}
          </div>

          <h4>Acceptance Tests (اختبارات القبول)</h4>
          <ul className="factory-tests">
            {blueprint.acceptanceTests.map((test) => <li key={test.id}><strong>✓ {test.title}</strong><span>{test.description}</span></li>)}
          </ul>

          <FactoryIntelligenceCenter
            blueprint={blueprint}
            onBlueprintChange={(next) => {
              setBlueprint(next)
              setApproved(false)
              setRevision((value) => value + 1)
            }}
            onNotice={onNotice}
          />

          {preview && blueprint.status !== 'installed' && (
            <div className="factory-preview">
              <strong>Pre-Install Validation (فحص ما قبل التثبيت)</strong>
              <p>{preview.agents.length} Agents سيُنشؤون، وكلهم يبدأون بـ <code>allowedTools=[]</code> و0$.</p>
              <p>Workflow: {preview.workflow.nodes.length} Nodes (عقد) · {preview.workflow.edges.length} Edges (روابط).</p>
              <details>
                <summary>Security Checks (فحوص الأمان)</summary>
                <ul>{preview.checks.map((check, index) => <li key={`${check}-${index}`}>{check}</li>)}</ul>
              </details>
            </div>
          )}

          {blueprint.status !== 'installed' && (
            <div className="factory-install-box">
              <label className="factory-approval">
                <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
                <span>أوافق صراحة على إنشاء Agents (الوكلاء) وWorkflow فقط. لا أوافق على تشغيل أو إرسال أو شراء أو تفعيل أدوات تلقائياً.</span>
              </label>
              <button className="run-button" type="button" disabled={!approved || !preview} onClick={install}>
                ✓ Approve & Build Team (موافقة وإنشاء الفريق)
              </button>
            </div>
          )}
        </div>
      )}

      {recentAudit.length > 0 && (
        <details className="factory-audit">
          <summary>Factory Audit (سجل المصنع المحلي)</summary>
          <div className="factory-audit-list">
            {recentAudit.map((item) => (
              <div key={item.id}>
                <strong>{item.action}</strong>
                <small>{new Date(item.createdAt).toLocaleString('ar')} · ${item.monetaryCostUsd.toFixed(2)}</small>
                {item.error && <span>{item.error}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
