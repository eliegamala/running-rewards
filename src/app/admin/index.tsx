import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  AuthScreen,
  Notice,
  PrimaryButton,
  SecondaryButton,
  TextField,
  usePalette,
} from '@/components/auth-ui';
import { type PaletteColors, Spacing } from '@/constants/theme';
import {
  type AdminStore,
  type AuditEntry,
  getIsAdmin,
  getTwoStepStatus,
  getVerifiedFactorId,
  loadAdminStores,
  loadRecentChanges,
  loadStats,
  type RewardStats,
  startTwoStepSetup,
  type StatsPeriod,
  subscribe as subscribeToAdmin,
  type TwoStepSetup,
  type TwoStepStatus,
  verifyTwoStepCode,
} from '@/lib/admin';
import { getCategory } from '@/lib/stores';

const PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  category: 'category',
  reward: 'reward',
  description: 'about',
  opening_hours: 'hours',
  is_active: 'visibility',
  sort_order: 'order',
  product_image_path: 'product photo',
  venue_image_paths: 'venue photos',
  address: 'address',
  google_maps_url: 'Maps link',
  latitude: 'coordinates',
  longitude: 'coordinates',
};

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`;
}

function describeChange(entry: AuditEntry, storeNames: Map<string, string>) {
  const changes = entry.changes as Record<string, unknown>;
  const storeId =
    entry.table_name === 'stores' ? entry.record_id : String(changes.store_id ?? '');
  const name = storeNames.get(storeId) ?? (entry.table_name === 'stores' ? entry.record_id : 'a café');
  if (entry.table_name === 'store_locations') {
    if (entry.action === 'insert') return `Added a location to ${name}`;
    if (entry.action === 'delete') return `Removed a location from ${name}`;
    return `Edited a location of ${name}`;
  }
  if (entry.action === 'insert') return `Added ${name}`;
  if ('is_active' in changes && Array.isArray(changes.is_active)) {
    return `${changes.is_active[1] ? 'Showed' : 'Hid'} ${name}`;
  }
  const fields = [...new Set(Object.keys(changes).map((key) => FIELD_LABELS[key] ?? key))];
  return `Edited ${name}: ${fields.join(', ')}`;
}

// ---- Two-step login gate ----------------------------------------------------------------------

function TwoStepGate({ status, onVerified }: { status: TwoStepStatus; onVerified: () => void }) {
  const colors = usePalette();
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const begin = async () => {
    setBusy(true);
    setMessage(null);
    const result = await startTwoStepSetup();
    setBusy(false);
    if ('error' in result) setMessage(result.error);
    else setSetup(result);
  };

  const verify = async () => {
    setBusy(true);
    setMessage(null);
    const factorId = setup?.factorId ?? (await getVerifiedFactorId());
    if (!factorId) {
      setBusy(false);
      setMessage('No authenticator is set up yet.');
      return;
    }
    const result = await verifyTwoStepCode(factorId, code);
    setBusy(false);
    if (result.ok) onVerified();
    else setMessage(result.message);
  };

  const codeField = (
    <>
      <TextField
        label="6-digit code from your authenticator app"
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        placeholder="123456"
        onSubmitEditing={() => void verify()}
      />
      {message && (
        <Notice title="NOT VERIFIED" tone="error">
          {message}
        </Notice>
      )}
      <PrimaryButton label="VERIFY" onPress={() => void verify()} loading={busy} disabled={code.length !== 6} />
    </>
  );

  if (status === 'needs_code') {
    return (
      <>
        <Notice title="TWO-STEP LOGIN">
          Enter the current code from your authenticator app to open the admin tools.
        </Notice>
        {codeField}
      </>
    );
  }

  if (!setup) {
    return (
      <>
        <Notice title="SET UP TWO-STEP LOGIN FIRST">
          {'Admin tools need a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) as well as your password, so a stolen password alone can’t change anything.'}
        </Notice>
        {message && (
          <Notice title="SOMETHING WENT WRONG" tone="error">
            {message}
          </Notice>
        )}
        <PrimaryButton label="SET UP TWO-STEP LOGIN" onPress={() => void begin()} loading={busy} />
      </>
    );
  }

  return (
    <>
      <Notice title="1 · ADD RUN TO YOUR AUTHENTICATOR">
        Tap the button below, or add an account manually in your authenticator app with this key:
      </Notice>
      <View style={[styles.secretBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text selectable style={[styles.secret, { color: colors.text }]}>
          {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
        </Text>
        <Text style={[styles.secretHint, { color: colors.textMuted }]}>Press and hold to copy</Text>
      </View>
      <SecondaryButton label="OPEN AUTHENTICATOR APP" onPress={() => void Linking.openURL(setup.uri).catch(() => {})} />
      <Notice title="2 · ENTER THE CODE IT SHOWS">
        {'Keep the authenticator app — you’ll need a code each time you open Admin.'}
      </Notice>
      {codeField}
    </>
  );
}

// ---- Dashboard ------------------------------------------------------------------------------

function StatCard({ value, label, colors, dark = false }: { value: string; label: string; colors: PaletteColors; dark?: boolean }) {
  return (
    <View style={[styles.statCard, { backgroundColor: dark ? colors.hero : colors.surface }]}>
      <Text style={[styles.statValue, { color: dark ? colors.heroText : colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: dark ? colors.heroMuted : colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function Bar({ fraction, colors }: { fraction: number; colors: PaletteColors }) {
  return (
    <View style={[styles.barTrack, { backgroundColor: colors.surface }]}>
      <View style={[styles.barFill, { backgroundColor: colors.hero, width: `${Math.round(fraction * 100)}%` }]} />
    </View>
  );
}

function Dashboard() {
  const colors = usePalette();
  const [period, setPeriod] = useState<StatsPeriod>('30d');
  const [stats, setStats] = useState<RewardStats | null>(null);
  const [stores, setStores] = useState<AdminStore[] | null>(null);
  const [changes, setChanges] = useState<AuditEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (nextPeriod: StatsPeriod) => {
    const [statsResult, storesResult, changesResult] = await Promise.all([
      loadStats(nextPeriod),
      loadAdminStores(),
      loadRecentChanges(),
    ]);
    if (statsResult.ok) setStats(statsResult.stats);
    if (storesResult.ok) setStores(storesResult.stores);
    if (changesResult.ok) setChanges(changesResult.entries);
    const failure = [statsResult, storesResult, changesResult].find((r) => !r.ok);
    setMessage(failure && !failure.ok ? failure.message : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(period);
    }, [load, period]),
  );

  const storeNames = new Map((stores ?? []).map((s) => [s.id, s.name]));
  const maxRedeemed = Math.max(1, ...(stats?.stores ?? []).map((s) => s.redeemed));
  const maxWeekday = Math.max(1, ...(stats?.byWeekday ?? [0]));
  const busiestHours = (stats?.byHour ?? [])
    .map((count, hour) => ({ hour, count }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const rate = stats && stats.unlocked > 0 ? Math.round((stats.redeemed / stats.unlocked) * 100) : null;

  return (
    <>
      {message && (
        <Notice title="NOT LOADED" tone="error">
          {message}
        </Notice>
      )}

      <View style={styles.chips}>
        {PERIODS.map((p) => {
          const selected = p.id === period;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setPeriod(p.id)}
              style={[styles.chip, { backgroundColor: selected ? colors.hero : colors.surface }]}>
              <Text style={[styles.chipText, { color: selected ? colors.heroText : colors.text }]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {stats && (
        <>
          <View style={styles.statGrid}>
            <StatCard dark value={String(stats.redeemed)} label={`Rewards redeemed${rate !== null ? ` · ${rate}%` : ''}`} colors={colors} />
            <StatCard value={String(stats.unlocked)} label="Rewards unlocked" colors={colors} />
            <StatCard value={String(stats.expiredUnused)} label="Expired unused" colors={colors} />
            <StatCard value={String(stats.activeNow)} label="Active right now" colors={colors} />
            <StatCard value={String(stats.activeRunners)} label={`Runners earning (of ${stats.runners})`} colors={colors} />
            <StatCard value={String(stats.stravaConnected)} label="Strava connected" colors={colors} />
          </View>
          <Text style={[styles.small, { color: colors.textMuted }]}>
            {`From in-app runs ${stats.bySource.gps} · from Strava ${stats.bySource.strava}`}
            {stats.minutesToRedeem !== null ? ` · used ${stats.minutesToRedeem} min after unlocking on average` : ''}
          </Text>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>WHERE THEY’RE USED</Text>
          {stats.stores.map((s) => (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/admin/store/[id]', params: { id: s.id } })}
              style={[styles.storeStat, { borderTopColor: colors.border }]}>
              <View style={styles.storeStatTop}>
                <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                  {s.name}
                  {!s.isActive ? '  ·  hidden' : ''}
                </Text>
                <Text style={[styles.rowValue, { color: colors.text }]}>{s.redeemed}</Text>
              </View>
              <Bar fraction={s.redeemed / maxRedeemed} colors={colors} />
              <Text style={[styles.small, { color: colors.textMuted }]}>
                {`Chosen ${s.chosen} · redeemed ${s.redeemed}`}
                {s.lastRedeemedAt ? ` · last ${timeAgo(s.lastRedeemedAt)}` : ''}
              </Text>
            </Pressable>
          ))}

          <Text style={[styles.sectionTitle, { color: colors.text }]}>BUSIEST TIMES</Text>
          {stats.redeemed === 0 ? (
            <Text style={[styles.small, { color: colors.textMuted }]}>No rewards redeemed in this period yet.</Text>
          ) : (
            <>
              <View style={styles.weekdays}>
                {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                  <View key={day} style={styles.weekday}>
                    <View style={[styles.weekdayTrack, { backgroundColor: colors.surface }]}>
                      <View
                        style={[
                          styles.weekdayFill,
                          { backgroundColor: colors.hero, height: `${Math.round((stats.byWeekday[day] / maxWeekday) * 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={[styles.weekdayLabel, { color: colors.textMuted }]}>{WEEKDAYS[day]}</Text>
                  </View>
                ))}
              </View>
              {busiestHours.map((h) => (
                <Text key={h.hour} style={[styles.small, { color: colors.text }]}>
                  {`${hourLabel(h.hour)} · ${h.count} redeemed`}
                </Text>
              ))}
            </>
          )}
        </>
      )}

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>CAFÉS & CLUBS</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/admin/store/[id]', params: { id: 'new' } })}
          hitSlop={8}>
          <Text style={[styles.link, { color: colors.text }]}>+ Add</Text>
        </Pressable>
      </View>
      {(stores ?? []).map((s) => {
        const category = getCategory(s.category);
        const missing = [
          !s.reward && 'reward',
          s.store_locations.length === 0 && 'address',
          !s.product_image_path && 'product photo',
          s.venue_image_paths.length === 0 && 'venue photos',
        ].filter(Boolean);
        return (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/admin/store/[id]', params: { id: s.id } })}
            style={({ pressed }) => [styles.row, { borderTopColor: colors.border }, pressed && styles.pressed]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                {category.emoji} {s.name}
              </Text>
              <Text style={[styles.small, { color: colors.textMuted }]} numberOfLines={1}>
                {!s.is_active ? 'Hidden · ' : ''}
                {missing.length ? `Missing: ${missing.join(', ')}` : s.reward}
              </Text>
            </View>
            <Text style={[styles.link, { color: colors.text }]}>Edit ›</Text>
          </Pressable>
        );
      })}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>RECENT CHANGES</Text>
      {changes.length === 0 ? (
        <Text style={[styles.small, { color: colors.textMuted }]}>No changes yet.</Text>
      ) : (
        changes.map((entry) => (
          <View key={entry.id} style={[styles.change, { borderTopColor: colors.border }]}>
            <Text style={[styles.changeText, { color: colors.text }]}>{describeChange(entry, storeNames)}</Text>
            <Text style={[styles.small, { color: colors.textMuted }]}>
              {timeAgo(entry.created_at)}
              {entry.admin_id ? '' : ' · in the Supabase dashboard'}
            </Text>
          </View>
        ))
      )}
    </>
  );
}

/** Admin: two-step login, then stats and café management. Hidden from non-admins. */
export default function AdminScreen() {
  const isAdmin = useSyncExternalStore(subscribeToAdmin, getIsAdmin);
  const [status, setStatus] = useState<TwoStepStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      void getTwoStepStatus().then(setStatus);
    }, []),
  );

  return (
    <AuthScreen lead="Admin" accent="panel." intro={isAdmin ? 'Rewards at a glance, and your cafés.' : undefined}>
      {!isAdmin ? (
        <Notice title="NOT AVAILABLE">This area is only for RUN admins.</Notice>
      ) : status === null ? (
        <Notice>Checking two-step login…</Notice>
      ) : status === 'error' ? (
        <Notice title="NOT AVAILABLE" tone="error">
          {"Couldn't check two-step login. Check your connection and try again."}
        </Notice>
      ) : status === 'verified' ? (
        <Dashboard />
      ) : (
        <TwoStepGate status={status} onVerified={() => setStatus('verified')} />
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  secretBox: {
    borderWidth: 1,
    borderRadius: 18,
    padding: Spacing.three,
    gap: 4,
  },
  secret: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  secretHint: {
    fontSize: 12,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: 22,
    padding: Spacing.three,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  small: {
    fontSize: 13,
    lineHeight: 19,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: Spacing.four,
  },
  link: {
    fontSize: 14,
    fontWeight: '700',
  },
  storeStat: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 6,
  },
  storeStatTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  rowName: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  weekdays: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  weekday: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  weekdayTrack: {
    width: '100%',
    height: 72,
    borderRadius: 8,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  weekdayFill: {
    width: '100%',
    borderRadius: 8,
  },
  weekdayLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
  },
  change: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  changeText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
