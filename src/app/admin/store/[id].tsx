import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { AuthScreen, Notice, PrimaryButton, SecondaryButton, TextField, usePalette } from '@/components/auth-ui';
import { Spacing } from '@/constants/theme';
import {
  type AdminLocation,
  type AdminStore,
  checkLocation,
  createStore,
  deleteLocation,
  imageUrl,
  type LocationFields,
  loadAdminStores,
  MAX_VENUE_PHOTOS,
  removeStoreImage,
  saveLocation,
  setStoreImage,
  slugFor,
  type StoreFields,
  updateStore,
} from '@/lib/admin';
import { CATEGORIES } from '@/lib/stores';

const EMPTY_FIELDS: StoreFields = {
  name: '',
  category: 'coffee',
  reward: '',
  description: '',
  opening_hours: '',
  sort_order: 0,
  is_active: true,
};

type Status = { tone: 'info' | 'error'; title: string; text: string } | null;

function StatusNotice({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <Notice title={status.title} tone={status.tone}>
      {status.text}
    </Notice>
  );
}

function SectionTitle({ children }: { children: string }) {
  const colors = usePalette();
  return <Text style={[styles.sectionTitle, { color: colors.text }]}>{children}</Text>;
}

/** Multi-line text box in the same style as TextField. */
function TextArea({ label, value, onChangeText, maxLength, placeholder }: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  maxLength: number;
  placeholder?: string;
}) {
  const colors = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        style={[styles.textArea, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
      />
      <Text style={[styles.counter, { color: colors.textMuted }]}>{`${value.length}/${maxLength}`}</Text>
    </View>
  );
}

const toNumber = (text: string) => {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
};

function LocationEditor({ storeId, location, onChanged }: {
  storeId: string;
  location: AdminLocation | null;
  onChanged: () => void;
}) {
  const colors = usePalette();
  const [name, setName] = useState(location?.name ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [maps, setMaps] = useState(location?.google_maps_url ?? '');
  const [lat, setLat] = useState(location?.latitude?.toString() ?? '');
  const [lng, setLng] = useState(location?.longitude?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const save = async () => {
    const latitude = toNumber(lat);
    const longitude = toNumber(lng);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      setStatus({ tone: 'error', title: 'NOT SAVED', text: 'Coordinates must be numbers, e.g. -33.9268 and 18.4235.' });
      return;
    }
    const fields: LocationFields = { name, address, google_maps_url: maps, latitude, longitude };
    const problem = checkLocation(fields);
    if (problem) {
      setStatus({ tone: 'error', title: 'NOT SAVED', text: problem });
      return;
    }
    setBusy(true);
    const result = await saveLocation(storeId, location?.id ?? null, fields);
    setBusy(false);
    if (!result.ok) {
      setStatus({ tone: 'error', title: 'NOT SAVED', text: result.message });
      return;
    }
    setStatus({ tone: 'info', title: 'SAVED', text: 'The app shows this within a few minutes.' });
    if (!location) {
      setName('');
      setAddress('');
      setMaps('');
      setLat('');
      setLng('');
    }
    onChanged();
  };

  const remove = () => {
    if (!location) return;
    Alert.alert('Remove this location?', location.address, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const result = await deleteLocation(location.id);
          if (result.ok) onChanged();
          else setStatus({ tone: 'error', title: 'NOT REMOVED', text: result.message });
        },
      },
    ]);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text style={[styles.cardTitle, { color: colors.text }]}>{location ? 'Location' : 'Add a location'}</Text>
      <TextField label="Street address" value={address} onChangeText={setAddress} maxLength={200} placeholder="36 Buitenkant St, Cape Town, 8000" />
      <TextField label="Branch or area (optional)" value={name} onChangeText={setName} maxLength={80} placeholder="City Centre" />
      <TextField
        label="Google Maps link (optional)"
        value={maps}
        onChangeText={setMaps}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://maps.app.goo.gl/…"
      />
      <View style={styles.twoColumns}>
        <View style={styles.column}>
          <TextField label="Latitude (optional)" value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" placeholder="-33.9268" />
        </View>
        <View style={styles.column}>
          <TextField label="Longitude (optional)" value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" placeholder="18.4235" />
        </View>
      </View>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Without coordinates, phones find the café from its address.
      </Text>
      <StatusNotice status={status} />
      <PrimaryButton label={location ? 'SAVE LOCATION' : 'ADD LOCATION'} onPress={() => void save()} loading={busy} />
      {location && (
        <Pressable accessibilityRole="button" onPress={remove} hitSlop={8} style={styles.removeLink}>
          <Text style={[styles.dangerText, { color: colors.textMuted }]}>Remove this location</Text>
        </Pressable>
      )}
    </View>
  );
}

function Photos({ store, onChanged }: { store: AdminStore; onChanged: () => void }) {
  const colors = usePalette();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const pick = async (kind: 'product' | 'venue') => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    setBusy(kind);
    setStatus(null);
    const saved = await setStoreImage(store, asset.uri, kind);
    setBusy(null);
    if (saved.ok) onChanged();
    else setStatus({ tone: 'error', title: 'NOT UPLOADED', text: saved.message });
  };

  const remove = (path: string) => {
    Alert.alert('Remove this photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const result = await removeStoreImage(store, path);
          if (result.ok) onChanged();
          else setStatus({ tone: 'error', title: 'NOT REMOVED', text: result.message });
        },
      },
    ]);
  };

  const thumb = (path: string, wide: boolean) => (
    <View key={path} style={[wide ? styles.venueThumb : styles.productThumb, { backgroundColor: colors.card }]}>
      <Image source={{ uri: imageUrl(path) ?? undefined }} style={StyleSheet.absoluteFill} contentFit={wide ? 'cover' : 'contain'} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Remove photo"
        onPress={() => remove(path)}
        style={[styles.removeBadge, { backgroundColor: colors.hero }]}>
        <Text style={[styles.removeBadgeText, { color: colors.heroText }]}>✕</Text>
      </Pressable>
    </View>
  );

  return (
    <>
      <SectionTitle>PRODUCT PHOTO</SectionTitle>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        A drink or dish on a transparent background (PNG). Shown on the Home cards.
      </Text>
      <View style={styles.thumbRow}>
        {store.product_image_path && thumb(store.product_image_path, false)}
        {busy === 'product' && <ActivityIndicator />}
      </View>
      <SecondaryButton label={store.product_image_path ? 'REPLACE PRODUCT PHOTO' : 'CHOOSE PRODUCT PHOTO'} onPress={() => void pick('product')} />

      <SectionTitle>{`VENUE PHOTOS (${store.venue_image_paths.length}/${MAX_VENUE_PHOTOS})`}</SectionTitle>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Storefront, interior or counter, landscape. Shown at the top of the café page.
      </Text>
      <View style={styles.thumbRow}>
        {store.venue_image_paths.map((path) => thumb(path, true))}
        {busy === 'venue' && <ActivityIndicator />}
      </View>
      {store.venue_image_paths.length < MAX_VENUE_PHOTOS && (
        <SecondaryButton label="ADD VENUE PHOTO" onPress={() => void pick('venue')} />
      )}
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Only use photos the café has given you or approved.
      </Text>
      <StatusNotice status={status} />
    </>
  );
}

/** Add or edit a café / run club. Changes are checked by the database (admin + two-step). */
export default function AdminStoreScreen() {
  const colors = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [store, setStore] = useState<AdminStore | null>(null);
  const [fields, setFields] = useState<StoreFields>(EMPTY_FIELDS);
  const [orderText, setOrderText] = useState('0');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    if (isNew || typeof id !== 'string') return;
    const result = await loadAdminStores();
    setLoading(false);
    if (!result.ok) {
      setStatus({ tone: 'error', title: 'NOT LOADED', text: result.message });
      return;
    }
    const found = result.stores.find((s) => s.id === id) ?? null;
    setStore(found);
    if (found) {
      setFields({
        name: found.name,
        category: found.category,
        reward: found.reward ?? '',
        description: found.description ?? '',
        opening_hours: found.opening_hours ?? '',
        sort_order: found.sort_order,
        is_active: found.is_active,
      });
      setOrderText(String(found.sort_order));
    }
  }, [id, isNew]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const set = <K extends keyof StoreFields>(key: K, value: StoreFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!fields.name.trim()) {
      setStatus({ tone: 'error', title: 'NOT SAVED', text: 'Give the café a name.' });
      return;
    }
    setSaving(true);
    setStatus(null);
    const toSave = { ...fields, sort_order: Number.parseInt(orderText, 10) || 0 };
    if (isNew) {
      const result = await createStore(toSave);
      setSaving(false);
      if (!result.ok) setStatus({ tone: 'error', title: 'NOT SAVED', text: result.message });
      else router.replace({ pathname: '/admin/store/[id]', params: { id: result.id } });
      return;
    }
    const result = await updateStore(store!.id, toSave);
    setSaving(false);
    setStatus(
      result.ok
        ? { tone: 'info', title: 'SAVED', text: 'The app shows this within a few minutes.' }
        : { tone: 'error', title: 'NOT SAVED', text: result.message },
    );
    if (result.ok) void load();
  };

  const isRunClub = fields.category === 'run-club';

  if (!isNew && !loading && !store) {
    return (
      <AuthScreen lead="Café" accent="not found.">
        <StatusNotice status={status} />
        <SecondaryButton label="BACK" onPress={() => router.back()} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      lead={isNew ? 'Add a' : 'Edit'}
      accent={isNew ? 'café.' : `${store?.name ?? '…'}.`}
      intro={isNew ? `Its link name will be “${slugFor(fields.name) || '…'}” (can’t be changed later).` : undefined}>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <>
          <TextField label="Name" value={fields.name} onChangeText={(t) => set('name', t)} maxLength={80} placeholder="Truth Coffee Roasting" />

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.text }]}>Category</Text>
            <View style={styles.chips}>
              {CATEGORIES.map((c) => {
                const selected = c.id === fields.category;
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => set('category', c.id)}
                    style={[styles.chip, { backgroundColor: selected ? colors.hero : colors.surface }]}>
                    <Text style={[styles.chipText, { color: selected ? colors.heroText : colors.text }]}>
                      {c.emoji} {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <TextField
            label="Reward"
            value={fields.reward ?? ''}
            onChangeText={(t) => set('reward', t)}
            maxLength={80}
            placeholder="Free flat white"
          />
          <TextArea
            label="About (optional)"
            value={fields.description ?? ''}
            onChangeText={(t) => set('description', t)}
            maxLength={300}
            placeholder="A sentence or two from the café."
          />
          <TextField
            label={isRunClub ? 'When they run (optional)' : 'Opening hours (optional)'}
            value={fields.opening_hours ?? ''}
            onChangeText={(t) => set('opening_hours', t)}
            maxLength={120}
            placeholder={isRunClub ? 'Saturdays 6:30, from the Sea Point pavilion' : 'Mon–Fri 6:30–16:00 · Sat 7:00–13:00'}
          />
          <View style={[styles.switchRow, { borderColor: colors.border }]}>
            <View style={styles.rowText}>
              <Text style={[styles.label, { color: colors.text }]}>Visible in the app</Text>
              <Text style={[styles.hint, { color: colors.textMuted }]}>Turn off to hide it without deleting anything.</Text>
            </View>
            <Switch
              value={fields.is_active}
              onValueChange={(value) => set('is_active', value)}
              trackColor={{ true: colors.hero }}
              accessibilityLabel="Visible in the app"
            />
          </View>
          <TextField
            label="List order (lower comes first)"
            value={orderText}
            onChangeText={setOrderText}
            keyboardType="number-pad"
          />
          <StatusNotice status={status} />
          <PrimaryButton label={isNew ? 'ADD CAFÉ' : 'SAVE DETAILS'} onPress={() => void save()} loading={saving} />

          {store && (
            <>
              <SectionTitle>LOCATIONS</SectionTitle>
              {store.store_locations.map((location) => (
                <LocationEditor key={location.id} storeId={store.id} location={location} onChanged={() => void load()} />
              ))}
              <LocationEditor key={`new-${store.store_locations.length}`} storeId={store.id} location={null} onChanged={() => void load()} />

              <Photos store={store} onChanged={() => void load()} />

              <SecondaryButton
                label="VIEW IN THE APP"
                onPress={() => router.push({ pathname: '/store/[id]', params: { id: store.id } })}
              />
            </>
          )}
        </>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: Spacing.four,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
  },
  counter: {
    fontSize: 12,
    alignSelf: 'flex-end',
  },
  textArea: {
    minHeight: 96,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 16,
    textAlignVertical: 'top',
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  card: {
    borderRadius: 24,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  twoColumns: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  column: {
    flex: 1,
  },
  removeLink: {
    alignSelf: 'center',
  },
  dangerText: {
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  productThumb: {
    width: 96,
    height: 96,
    borderRadius: 18,
    overflow: 'hidden',
  },
  venueThumb: {
    width: 128,
    height: 96,
    borderRadius: 18,
    overflow: 'hidden',
  },
  removeBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
