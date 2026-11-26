'use client';
import { LoadingState } from '@/components/ui/LoadingState';
import { LoadingMark } from '@/components/ui/LoadingMark';
import { useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Plus, Trash2, Pencil, ChevronDown, Check, Monitor, KeyRound, Users } from 'lucide-react';
import { sessionDevice } from '@/lib/utils/sessionDevice';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import UserContext from '@/lib/contexts/UserContext';
import UpdateProfile from '@/components/profile/UpdateProfile';
import UpdatePassword from '@/components/profile/UpdatePassword';
import UpdateProfilePicture from '@/components/profile/UpdateProfilePicture';
import SecuritySettings from '@/components/profile/SecuritySettings';
import { useShelfUploads } from './ShelfUploads';
import { shelfApi } from './api';
import { Dialog } from './Dialog';
import { ApiKeySecret } from './ApiKeySecret';
import { PasswordField, PasswordFields } from '@/components/ui/PasswordField';
import { FormError } from '@/components/ui/FormError';
import { MotionDetails } from '@/components/ui/MotionDetails';
import { Button } from '@/components/ui/primitives';
import { getApiErrorMessage, getApiFieldErrors } from '@/lib/utils/apiErrorMessages';
import { validateAccountForm } from '@/lib/utils/accountValidation';
import { USERNAME_MIN, USERNAME_MAX } from '@/lib/utils/validationPatterns';
type Section = 'account' | 'security' | 'sessions' | 'api' | 'instance' | 'users';
type Item<T> = { id: string; attributes: T };
type KeyAttributes = { name: string; scopes: string[]; expiresAt: string; neverExpires?: boolean };
type SessionAttributes = {
  userAgent: string;
  ipAddress: string;
  isCurrent: boolean;
  readableLastActivityAt: string;
  lastActivityAt?: string;
};
type UserAttributes = { username: string; email: string; role: string; quotaLimit: number };
type Instance = {
  publicUrl: string;
  maxUploadSize: number;
};
type Mail = {
  host: string;
  port: number;
  user: string;
  from: string;
  secure: boolean;
  pass?: string;
};
export function ShelfSettings() {
  const format = useFormatter();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const t = useTranslations('shelf'),
    tc = useTranslations('common'),
    tv = useTranslations('validation'),
    user = useContext(UserContext),
    router = useRouter(),
    uploads = useShelfUploads();
  const admin = user?.data?.attributes.role === 'admin';
  const [section, setSection] = useState<Section>('account'),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState<string | null>(null),
    [confirmation, setConfirmation] = useState<{
      url: string;
      warning: string;
      name: string;
    } | null>(null),
    [removalError, setRemovalError] = useState(''),
    [error, setError] = useState(''),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(false),
    [loadFailed, setLoadFailed] = useState(false),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [version, setVersion] = useState(0),
    [keys, setKeys] = useState<Item<KeyAttributes>[]>([]),
    [sessions, setSessions] = useState<Item<SessionAttributes>[]>([]),
    [users, setUsers] = useState<Item<UserAttributes>[]>([]),
    [instance, setInstance] = useState<Instance>({
      publicUrl: '',
      maxUploadSize: 0,
    }),
    [mail, setMail] = useState<Mail>({ host: '', port: 587, user: '', from: '', secure: false }),
    [dialog, setDialog] = useState<'key' | 'user' | 'secret' | null>(null),
    [secret, setSecret] = useState(''),
    [editing, setEditing] = useState<Item<UserAttributes> | null>(null),
    [userRole, setUserRole] = useState('user'),
    [keyExpiration, setKeyExpiration] = useState('2'),
    [scopes, setScopes] = useState(['read', 'write']);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    setFieldErrors({});
  }, [dialog, editing]);
  const fieldProps = (name: string) => ({
    id: `settings-user-${name}`,
    'aria-invalid': !!fieldErrors[name] || undefined,
    'aria-describedby': fieldErrors[name] ? `settings-user-${name}-error` : undefined,
  });
  const fieldHint = (name: string) =>
    fieldErrors[name] ? (
      <span className="form-field-error" id={`settings-user-${name}-error`}>
        {fieldErrors[name]}
      </span>
    ) : null;
  useEffect(() => {
    let live = true;
    setError('');
    setLoadFailed(false);
    setPages(1);
    if (section === 'account' || section === 'security') {
      setLoading(false);
      return;
    }
    setLoading(true);
    const load = async () => {
      if (section === 'api') {
        const r = await shelfApi<{
          apiKeys: { data: Item<KeyAttributes>[] };
          pagy: { pages: number };
        }>(`/api/v1/api_keys?page=${page}`);
        if (live) {
          setKeys(r.apiKeys.data);
          setPages(r.pagy.pages);
          setPage((current) => Math.min(current, r.pagy.pages));
        }
      }
      if (section === 'sessions') {
        const r = await shelfApi<{
          sessions: { data: Item<SessionAttributes>[] };
          pagy: { pages: number };
        }>(`/api/v1/sessions?page=${page}`);
        if (live) {
          setSessions(r.sessions.data);
          setPages(r.pagy.pages);
          setPage((current) => Math.min(current, r.pagy.pages));
        }
      }
      if (section === 'users') {
        const r = await shelfApi<{
          users: { data: Item<UserAttributes>[] };
          pagy: { pages: number };
        }>(`/api/v1/users?page=${page}`);
        if (live) {
          setUsers(r.users.data);
          setPages(r.pagy.pages);
          setPage((current) => Math.min(current, r.pagy.pages));
        }
      }
      if (section === 'instance') {
        const [r, m] = await Promise.all([
          shelfApi<{ settings: Instance & { publicUrlOverride?: string } }>('/api/v1/instance'),
          shelfApi<Mail>('/api/v1/settings/smtp'),
        ]);
        if (live) {
          setInstance({ ...r.settings, publicUrl: r.settings.publicUrlOverride ?? '' });
          setMail(m);
        }
      }
    };
    load()
      .catch(() => {
        if (live) {
          setError(t('requestFailed'));
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [section, page, version, t]);
  async function submit(
    e: React.FormEvent<HTMLFormElement>,
    operation: 'key' | 'user' | 'instance' | 'mail',
  ) {
    e.preventDefault();
    if (operation === 'key' && scopes.length === 0) return;
    setAttempt((value) => value + 1);
    setError('');
    const data = new FormData(e.currentTarget);
    const values = Object.fromEntries(data.entries());
    const issues = operation === 'user' ? validateAccountForm(values, tv, !editing) : {};
    setFieldErrors(issues);
    if (Object.keys(issues).length) {
      setError(tc('formReviewFields'));
      return;
    }
    setBusy(true);
    try {
      if (operation === 'key') {
        const r = await shelfApi<{ encoded_token: string }>('/api/v1/api_keys', {
          method: 'POST',
          body: JSON.stringify({
            api_key: { name: values.name, expiration: Number(values.expiration), scopes },
          }),
        });
        setSecret(r.encoded_token);
        setDialog('secret');
        reload();
      }
      if (operation === 'user') {
        const payload: Record<string, unknown> = { ...values, quota: Number(values.quota) };
        if (editing && !values.password) {
          delete payload.password;
          delete payload.password_confirmation;
        }
        await shelfApi(editing ? `/api/v1/users/${editing.id}` : '/api/v1/users', {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify({ user: payload }),
        });
        setDialog(null);
        reload();
        uploads.refresh();
        uploads.notify(t(editing ? 'userSaved' : 'userCreated'));
        router.refresh();
      }
      if (operation === 'instance') {
        await shelfApi('/api/v1/instance', {
          method: 'PATCH',
          body: JSON.stringify({ settings: instance }),
        });
        uploads.notify(t('profileSaved'));
        router.refresh();
      }
      if (operation === 'mail') {
        await shelfApi('/api/v1/settings/smtp', { method: 'PUT', body: JSON.stringify(mail) });
        uploads.notify(t('mailSaved'));
      }
    } catch (cause) {
      const fields = getApiFieldErrors(cause, tc);
      setFieldErrors(fields);
      setError(
        Object.keys(fields).length
          ? tc('formReviewFields')
          : getApiErrorMessage(cause, tc, 'apiErrorRequestFailed'),
      );
    } finally {
      setBusy(false);
    }
  }
  function remove(url: string, warning: string, name: string) {
    setRemovalError('');
    setConfirmation({ url, warning, name });
  }
  function deviceLabel(attributes: SessionAttributes) {
    const device = sessionDevice(attributes.userAgent);
    return t('sessionDevice', {
      browser: device.browser || t('unknownBrowser'),
      system: device.system || t('unknownDevice'),
    });
  }
  async function confirmRemoval() {
    if (!confirmation || busy) return;
    const { url } = confirmation;
    setRemovalError('');
    setBusy(true);
    setRemoving(url);
    try {
      await shelfApi(url, { method: 'DELETE' });
      setConfirmation(null);
      reload();
    } catch {
      setRemovalError(t('requestFailed'));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }
  const sections: Section[] = admin
    ? ['account', 'security', 'sessions', 'api', 'instance', 'users']
    : ['account', 'security', 'sessions', 'api'];
  const changeSection = (value: Section) => {
    setSection(value);
    setPage(1);
    setError('');
  };
  return (
    <>
      <section className="intro">
        <h1>{t('settings')}</h1>
        <p>{t('settingsIntro')}</p>
      </section>
      <div className="settings-layout">
        <div className="settings-mobile-nav">
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="settings-section-trigger"
                aria-label={t('settingsSection')}
              >
                <span>{t(`${section}Settings`)}</span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="library-sort-menu settings-section-menu"
                align="start"
                sideOffset={6}
                collisionPadding={12}
              >
                <DropdownMenu.RadioGroup
                  value={section}
                  aria-label={t('settingsSection')}
                  onValueChange={(value) => changeSection(value as Section)}
                >
                  {sections.map((value) => (
                    <DropdownMenu.RadioItem
                      className="library-sort-option"
                      key={value}
                      value={value}
                    >
                      <span>{t(`${value}Settings`)}</span>
                      <DropdownMenu.ItemIndicator>
                        <Check size={16} aria-hidden="true" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        <nav className="settings-nav" aria-label={t('settings')}>
          {sections.map((s) => (
            <button key={s} aria-current={section === s} onClick={() => changeSection(s)}>
              {t(`${s}Settings`)}
            </button>
          ))}
        </nav>
        <section className="settings-panel">
          <h2>{t(`${section}Settings`)}</h2>
          {error && !dialog && (
            <p className="shelf-error" role="alert">
              {error}{' '}
              <button onClick={reload} className="text-button">
                {t('retry')}
              </button>
            </p>
          )}
          {loading ? (
            <LoadingState />
          ) : !loadFailed ? (
            <div className="settings-section-content" key={`${section}:${page}`}>
              {section === 'account' && (
                <div className="settings-list settings-account">
                  <UpdateProfilePicture />
                  <UpdateProfile />
                </div>
              )}
              {section === 'security' && (
                <div className="settings-list">
                  <section className="settings-group">
                    <div className="settings-group-heading">
                      <h3>{t('password')}</h3>
                      <p>{t('passwordHint')}</p>
                    </div>
                    <UpdatePassword />
                  </section>
                  <SecuritySettings />
                </div>
              )}
              {section === 'api' && (
                <>
                  <div className="settings-section-heading">
                    <p className="settings-hint">{t('apiIntro')}</p>
                    <button
                      className="button"
                      onClick={() => {
                        setError('');
                        setScopes(['read', 'write']);
                        setKeyExpiration('2');
                        setDialog('key');
                      }}
                    >
                      <Plus size={15} />
                      {t('createKey')}
                    </button>
                  </div>
                  <div className="settings-list">
                    {!keys.length && (
                      <div className="settings-empty">
                        <KeyRound size={24} aria-hidden="true" />
                        <p>{t('noKeys')}</p>
                        <span>{t('keysEmptyHint')}</span>
                      </div>
                    )}
                    {keys.map((key) => (
                      <div className="settings-row" key={key.id}>
                        <span>
                          {key.attributes.name}
                          <small>
                            {key.attributes.scopes.map((scope) => t(`scope_${scope}`)).join(' · ')}{' '}
                            ·{' '}
                            {key.attributes.neverExpires
                              ? t('neverExpires')
                              : t('keyExpires', {
                                  date: format.dateTime(new Date(key.attributes.expiresAt), {
                                    dateStyle: 'medium',
                                    timeZone,
                                  }),
                                })}
                          </small>
                        </span>
                        <button
                          className="icon-button"
                          disabled={busy}
                          aria-label={t('revokeKey')}
                          aria-busy={removing === `/api/v1/api_keys/${key.id}` || undefined}
                          onClick={() =>
                            void remove(
                              `/api/v1/api_keys/${key.id}`,
                              'keyWarning',
                              key.attributes.name,
                            )
                          }
                        >
                          {removing === `/api/v1/api_keys/${key.id}` ? (
                            <LoadingMark size={18} />
                          ) : (
                            <Trash2 size={15} />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                  <MotionDetails className="settings-disclosure">
                    <summary>
                      {t('uploaderInstructions')}
                      <ChevronDown size={16} aria-hidden="true" />
                    </summary>
                    <div className="settings-disclosure-body settings-uploader-help">
                      <p>{t('apiHint', { permission: t('scope_write') })}</p>
                      <dl className="settings-uploader-fields">
                        <div>
                          <dt>{t('uploaderEndpoint')}</dt>
                          <dd>
                            <code>POST /api/v1/uploads</code>
                          </dd>
                        </div>
                        <div>
                          <dt>{t('uploaderAuth')}</dt>
                          <dd>
                            <code>Authorization: Bearer &lt;API_KEY&gt;</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Content-Type</dt>
                          <dd>
                            <code>multipart/form-data</code>
                          </dd>
                        </div>
                        <div>
                          <dt>
                            <code>file</code>
                          </dt>
                          <dd>{t('uploaderFile')}</dd>
                        </div>
                        <div>
                          <dt>
                            <code>share</code>
                          </dt>
                          <dd>
                            {t.rich('uploaderShare', { code: (chunks) => <code>{chunks}</code> })}
                          </dd>
                        </div>
                        <div>
                          <dt>
                            <code>collection</code>
                          </dt>
                          <dd>{t('uploaderCollection')}</dd>
                        </div>
                      </dl>
                      <h4>{t('uploaderExample')}</h4>
                      <pre className="settings-uploader-code">
                        <code>
                          {
                            'curl "$PIXB_URL/api/v1/uploads" \\\n  -H "Authorization: Bearer $PIXB_API_KEY" \\\n  -F "file=@./image.png" \\\n  -F "share=true"'
                          }
                        </code>
                      </pre>
                      <p>{t('uploaderExampleHint')}</p>
                      <h4>{t('uploaderResponse')}</h4>
                      <pre className="settings-uploader-code">
                        <code>
                          {JSON.stringify(
                            {
                              file: {
                                id: '42',
                                name: 'image.png',
                                mime: 'image/png',
                                size: '24816',
                                createdAt: '2026-11-01T12:00:00.000Z',
                                kind: 'image',
                                favorite: false,
                                shared: true,
                                collections: [],
                                links: {
                                  original: 'https://pixb.example/raw/aB3dE7fGhJ9kLmNpQrStUw.png',
                                  download: 'https://pixb.example/dl/aB3dE7fGhJ9kLmNpQrStUw.png',
                                  thumbnail: 'https://pixb.example/thumb/aB3dE7fGhJ9kLmNpQrStUw',
                                  poster: null,
                                  preview: null,
                                  share: 'https://pixb.example/s/aB3dE7fGhJ9kLmNpQrStUw.png',
                                },
                              },
                              shareUrl: 'https://pixb.example/s/aB3dE7fGhJ9kLmNpQrStUw.png',
                              rawUrl: 'https://pixb.example/raw/aB3dE7fGhJ9kLmNpQrStUw.png',
                            },
                            null,
                            2,
                          )}
                        </code>
                      </pre>
                      <p>
                        {t.rich('uploaderResponseHint', {
                          code: (chunks) => <code>{chunks}</code>,
                        })}
                      </p>
                    </div>
                  </MotionDetails>
                </>
              )}
              {section === 'sessions' && (
                <div className="settings-list">
                  <p className="settings-hint">{t('sessionsHint')}</p>
                  {!sessions.length && <p>{t('emptySessions')}</p>}
                  {sessions.map((session) => (
                    <div className="settings-row settings-session-card" key={session.id}>
                      <Monitor className="settings-device-icon" size={21} aria-hidden="true" />
                      <div className="settings-row-copy">
                        <strong>{deviceLabel(session.attributes)}</strong>
                        <small>{session.attributes.ipAddress}</small>
                      </div>
                      {session.attributes.isCurrent ? (
                        <span className="settings-badge">{t('sessionCurrent')}</span>
                      ) : (
                        <button
                          className="button"
                          disabled={busy}
                          aria-busy={removing === `/api/v1/sessions/${session.id}` || undefined}
                          onClick={() =>
                            void remove(
                              `/api/v1/sessions/${session.id}`,
                              'sessionWarning',
                              deviceLabel(session.attributes),
                            )
                          }
                        >
                          {removing === `/api/v1/sessions/${session.id}` && (
                            <LoadingMark size={18} />
                          )}
                          {t('revokeSession')}
                        </button>
                      )}
                      <MotionDetails className="settings-device-details">
                        <summary>{t('deviceDetails')}</summary>
                        <p>{session.attributes.userAgent}</p>
                        <small>
                          {session.attributes.lastActivityAt
                            ? t('sessionLastActive', {
                                date: format.dateTime(new Date(session.attributes.lastActivityAt), {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                  timeZone,
                                }),
                              })
                            : session.attributes.readableLastActivityAt}
                        </small>
                      </MotionDetails>
                    </div>
                  ))}
                </div>
              )}
              {section === 'users' && (
                <>
                  <div className="settings-section-heading">
                    <p className="settings-hint">{t('usersHint')}</p>
                    <button
                      className="button"
                      onClick={() => {
                        setEditing(null);
                        setUserRole('user');
                        setError('');
                        setDialog('user');
                      }}
                    >
                      <Plus size={15} />
                      {t('createUser')}
                    </button>
                  </div>
                  <div className="settings-list">
                    {users.map((item) => (
                      <div className="settings-row" key={item.id}>
                        <span className="settings-user-icon">
                          <Users size={19} aria-hidden="true" />
                        </span>
                        <div className="settings-row-copy">
                          <strong>{item.attributes.username}</strong>
                          <small>{item.attributes.email}</small>
                          <small>
                            {t('role_' + item.attributes.role)} ·{' '}
                            {item.attributes.quotaLimit === 0
                              ? t('noStorageLimit')
                              : t('userQuota', { amount: item.attributes.quotaLimit })}
                          </small>
                        </div>
                        <div className="settings-row-actions">
                          <button
                            className="icon-button"
                            aria-label={t('editUser')}
                            onClick={() => {
                              setEditing(item);
                              setUserRole(item.attributes.role);
                              setError('');
                              setDialog('user');
                            }}
                          >
                            <Pencil size={15} />
                          </button>
                          {item.id !== user?.data?.id && (
                            <button
                              className="icon-button"
                              aria-label={t('deleteUser')}
                              aria-busy={
                                removing === `/api/v1/users/${item.id}/delete` || undefined
                              }
                              disabled={busy}
                              onClick={() =>
                                void remove(
                                  `/api/v1/users/${item.id}/delete`,
                                  'deleteUserWarning',
                                  item.attributes.username,
                                )
                              }
                            >
                              {removing === `/api/v1/users/${item.id}/delete` ? (
                                <LoadingMark size={18} />
                              ) : (
                                <Trash2 size={15} />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {section === 'instance' && (
                <div className="settings-list">
                  <form
                    className="shelf-form settings-instance-form"
                    onSubmit={(e) => void submit(e, 'instance')}
                  >
                    <MotionDetails className="settings-disclosure">
                      <summary>
                        <span>
                          {t('advancedOptions')}
                          <small>
                            {instance.publicUrl
                              ? t('customAddressActive')
                              : t('installationAddress')}
                          </small>
                          <small>
                            {instance.maxUploadSize > 0
                              ? t('uploadLimitSummary', { size: instance.maxUploadSize })
                              : t('noUploadLimit')}
                          </small>
                        </span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </summary>
                      <div className="settings-disclosure-body">
                        <label className="settings-field settings-field-publicUrl">
                          {t('publicUrl')}
                          <input
                            type="text"
                            maxLength={2000}
                            value={instance.publicUrl}
                            onChange={(e) =>
                              setInstance((prev) => ({ ...prev, publicUrl: e.target.value }))
                            }
                          />
                          <small>{t('publicUrlHint')}</small>
                        </label>
                        <label className="settings-field settings-field-maxUploadSize">
                          {t('maxUploadSize')}
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={instance.maxUploadSize}
                            onChange={(e) =>
                              setInstance((prev) => ({
                                ...prev,
                                maxUploadSize: Number(e.target.value),
                              }))
                            }
                          />
                        </label>
                      </div>
                    </MotionDetails>
                    <button
                      disabled={busy}
                      aria-busy={busy || undefined}
                      className="button primary-button"
                    >
                      {busy && <LoadingMark size={18} />}
                      {t('save')}
                    </button>
                  </form>
                  <MotionDetails className="settings-disclosure">
                    <summary>
                      <span>
                        {t('mailSettings')}
                        <small>{t('mailHint')}</small>
                      </span>
                      <ChevronDown size={16} aria-hidden="true" />
                    </summary>
                    <form
                      className="shelf-form settings-mail-form settings-disclosure-body"
                      onSubmit={(e) => void submit(e, 'mail')}
                    >
                      {(['host', 'port', 'user', 'pass', 'from'] as const).map((key) =>
                        key === 'pass' ? (
                          <PasswordField
                            key={key}
                            id="smtp-password"
                            label={t('smtp_pass')}
                            autoComplete="off"
                            value={mail.pass ?? ''}
                            disabled={busy}
                            onChange={(event) =>
                              setMail((prev) => ({ ...prev, pass: event.target.value }))
                            }
                          />
                        ) : (
                          <label key={key}>
                            {t(`smtp_${key}`)}
                            <input
                              type={key === 'port' ? 'number' : 'text'}
                              autoComplete="off"
                              value={mail[key] ?? ''}
                              onChange={(e) =>
                                setMail((prev) => ({
                                  ...prev,
                                  [key]: key === 'port' ? Number(e.target.value) : e.target.value,
                                }))
                              }
                            />
                          </label>
                        ),
                      )}
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={mail.secure}
                          onChange={(e) =>
                            setMail((prev) => ({ ...prev, secure: e.target.checked }))
                          }
                        />
                        {t('smtp_secure')}
                      </label>
                      <button
                        disabled={busy}
                        aria-busy={busy || undefined}
                        className="button primary-button"
                      >
                        {busy && <LoadingMark size={18} />}
                        {t('save')}
                      </button>
                    </form>
                  </MotionDetails>
                </div>
              )}
              {pages > 1 && (
                <div className="settings-row">
                  <button
                    className="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {t('previousPage')}
                  </button>
                  <span>
                    {page} / {pages}
                  </span>
                  <button
                    className="button"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('nextPage')}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
      {confirmation && (
        <Dialog
          mobilePresentation="sheet"
          title={t(
            confirmation.warning === 'sessionWarning'
              ? 'revokeSession'
              : confirmation.warning === 'keyWarning'
                ? 'revokeKey'
                : 'deleteUser',
          )}
          canClose={!busy}
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          <div className="shelf-form">
            <p>{t(confirmation.warning, { name: confirmation.name })}</p>
            {removalError && <p role="alert">{removalError}</p>}
            <div className="settings-confirm-actions">
              <Button isDisabled={busy} onPress={() => setConfirmation(null)}>
                {tc('cancel')}
              </Button>
              <button
                type="button"
                className="button primary-button"
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => void confirmRemoval()}
              >
                {busy && <LoadingMark size={18} />}
                {t(
                  confirmation.warning === 'sessionWarning'
                    ? 'revokeSession'
                    : confirmation.warning === 'keyWarning'
                      ? 'revokeKey'
                      : 'deleteUser',
                )}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {dialog && (
        <Dialog
          mobilePresentation="sheet"
          canClose={!busy}
          title={t(
            dialog === 'key'
              ? 'createKey'
              : dialog === 'secret'
                ? 'copyKey'
                : editing
                  ? 'editUser'
                  : 'createUser',
          )}
          onClose={() => {
            if (!busy) {
              setDialog(null);
              setSecret('');
              setError('');
            }
          }}
        >
          {dialog === 'secret' ? (
            <ApiKeySecret
              secret={secret}
              onClose={() => {
                setDialog(null);
                setSecret('');
                setError('');
              }}
            />
          ) : (
            <form
              className="shelf-form"
              onSubmit={(e) => void submit(e, dialog)}
              noValidate={dialog === 'user'}
              onChange={(event) => {
                const input = event.target as HTMLElement;
                if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement))
                  return;
                if (!fieldErrors[input.name]) return;
                const remaining = { ...fieldErrors };
                delete remaining[input.name];
                setFieldErrors(remaining);
                if (!Object.keys(remaining).length) setError('');
              }}
            >
              {error && (
                <FormError message={error} key={attempt}>
                  {Object.keys(fieldErrors).length > 0 && (
                    <ul>
                      {Object.entries(fieldErrors).map(([field, message]) => (
                        <li key={field}>
                          {dialog === 'user' ? (
                            <a
                              href={`#settings-user-${field}`}
                              onClick={() =>
                                document.getElementById(`settings-user-${field}`)?.focus()
                              }
                            >
                              {message}
                            </a>
                          ) : (
                            message
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </FormError>
              )}
              {dialog === 'key' ? (
                <>
                  <label>
                    {t('keyName')}
                    <input name="name" required maxLength={20} />
                  </label>
                  <div className="auth-field">
                    <label htmlFor="settings-key-expiration">{t('expiration')}</label>
                    <input type="hidden" name="expiration" value={keyExpiration} />
                    <DropdownMenu.Root modal={false}>
                      <DropdownMenu.Trigger asChild>
                        <button
                          id="settings-key-expiration"
                          type="button"
                          className="settings-role-trigger"
                          disabled={busy}
                        >
                          <span>
                            {t(['day1', 'day7', 'day30', 'day365', 'never'][Number(keyExpiration)])}
                          </span>
                          <ChevronDown size={16} aria-hidden="true" />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="library-sort-menu settings-role-menu"
                          onEscapeKeyDown={(event) => event.stopPropagation()}
                          align="start"
                          sideOffset={6}
                          collisionPadding={12}
                        >
                          <DropdownMenu.RadioGroup
                            value={keyExpiration}
                            aria-label={t('expiration')}
                            onValueChange={setKeyExpiration}
                          >
                            {['day1', 'day7', 'day30', 'day365', 'never'].map((key, i) => (
                              <DropdownMenu.RadioItem
                                className="library-sort-option"
                                key={key}
                                value={String(i)}
                              >
                                <span>{t(key)}</span>
                                <DropdownMenu.ItemIndicator>
                                  <Check size={16} aria-hidden="true" />
                                </DropdownMenu.ItemIndicator>
                              </DropdownMenu.RadioItem>
                            ))}
                          </DropdownMenu.RadioGroup>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                  <fieldset
                    className="key-permissions"
                    aria-describedby={scopes.length === 0 ? 'key-scopes-help' : undefined}
                  >
                    <legend>{t('scopes')}</legend>
                    {['read', 'write', 'delete'].map((scope) => (
                      <label className="key-permission" key={scope}>
                        <input
                          type="checkbox"
                          checked={scopes.includes(scope)}
                          onChange={(e) =>
                            setScopes((prev) =>
                              e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                            )
                          }
                        />
                        <span className="key-permission-check" aria-hidden="true">
                          <Check size={14} />
                        </span>
                        <span>{t(`scope_${scope}`)}</span>
                      </label>
                    ))}
                  </fieldset>
                  {scopes.length === 0 && (
                    <p id="key-scopes-help" className="settings-hint" role="status">
                      {t('keyPermissionsRequired')}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="auth-field">
                    <label htmlFor="settings-user-username">{t('username')}</label>
                    <input
                      name="username"
                      {...fieldProps('username')}
                      required
                      defaultValue={editing?.attributes.username}
                      minLength={USERNAME_MIN}
                      maxLength={USERNAME_MAX}
                    />
                    {fieldHint('username')}
                  </div>
                  <div className="auth-field">
                    <label htmlFor="settings-user-email">{t('email')}</label>
                    <input
                      name="email"
                      {...fieldProps('email')}
                      type="email"
                      required
                      defaultValue={editing?.attributes.email}
                    />
                    {fieldHint('email')}
                  </div>
                  <PasswordFields
                    idPrefix="settings-user"
                    passwordLabel={t('password')}
                    confirmationLabel={t('confirmPassword')}
                    required={!editing}
                    disabled={busy}
                    errors={fieldErrors}
                    onValuesChange={() => {
                      setFieldErrors((current) => {
                        const remaining = { ...current };
                        delete remaining.password;
                        delete remaining.password_confirmation;
                        return remaining;
                      });
                    }}
                  />
                  <div className="auth-field">
                    <label htmlFor="settings-user-quota">{t('quota')}</label>
                    <input
                      name="quota"
                      {...fieldProps('quota')}
                      type="number"
                      min={1}
                      step={1}
                      max={2147483647}
                      placeholder={t('noStorageLimit')}
                      defaultValue={editing?.attributes.quotaLimit || ''}
                    />
                    {fieldHint('quota')}
                    <small>{t('quotaHint')}</small>
                  </div>
                  <div className="auth-field">
                    <label htmlFor="settings-user-role">{t('role')}</label>
                    <input type="hidden" name="role" value={userRole} />
                    <DropdownMenu.Root modal={false}>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          className="settings-role-trigger"
                          {...fieldProps('role')}
                          disabled={busy}
                        >
                          <span>{t(`role_${userRole}`)}</span>
                          <ChevronDown size={16} aria-hidden="true" />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="library-sort-menu settings-role-menu"
                          onEscapeKeyDown={(event) => event.stopPropagation()}
                          align="start"
                          sideOffset={6}
                          collisionPadding={12}
                        >
                          <DropdownMenu.RadioGroup
                            value={userRole}
                            aria-label={t('role')}
                            onValueChange={(value) => {
                              setUserRole(value);
                              const remaining = { ...fieldErrors };
                              delete remaining.role;
                              setFieldErrors(remaining);
                              if (!Object.keys(remaining).length) setError('');
                            }}
                          >
                            {['user', 'admin'].map((role) => (
                              <DropdownMenu.RadioItem
                                className="library-sort-option"
                                key={role}
                                value={role}
                              >
                                <span>{t(`role_${role}`)}</span>
                                <DropdownMenu.ItemIndicator>
                                  <Check size={16} aria-hidden="true" />
                                </DropdownMenu.ItemIndicator>
                              </DropdownMenu.RadioItem>
                            ))}
                          </DropdownMenu.RadioGroup>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                    {fieldHint('role')}
                  </div>
                </>
              )}
              <div className="dialog-actions">
                <Button
                  isDisabled={busy}
                  onPress={() => {
                    setDialog(null);
                    setSecret('');
                    setError('');
                  }}
                >
                  {tc('cancel')}
                </Button>
                <button
                  className="button primary-button"
                  disabled={busy || (dialog === 'key' && scopes.length === 0)}
                  aria-busy={busy || undefined}
                >
                  {busy && <LoadingMark size={18} />}
                  {t(dialog === 'key' ? 'createKey' : editing ? 'save' : 'createUser')}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
