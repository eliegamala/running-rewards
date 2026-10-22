import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { AuthScreen, Notice, PrimaryButton, SecondaryButton, TextField, usePalette } from '@/components/auth-ui';
import { Spacing } from '@/constants/theme';
import {
  addProduct,
  type AdminLocation,
  type AdminProduct,
  type AdminStore,
  checkLocation,
  createStore,
  deleteLocation,
  imageUrl,
  type LocationFields,
  loadAdminStores,
  MAX_MENU_PHOTOS,
  MAX_PRODUCTS,
  MAX_VENUE_PHOTOS,
  moveProduct,
  removeProduct,
  removeStoreImage,
  renameProduct,
  saveLocation,
  setProductImage,
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

async function pickImage() {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
  return result.canceled ? null : (result.assets?.[0]?.uri ?? null);
}

function Thumb({ path, shape, onRemove }: { path: string; shape: 'square' | 'wide' | 'tall'; onRemove: () => void }) {
  const colors = usePalette();
  return (
    <View
      style={[
        shape === 'wide' ? styles.venueThumb : shape === 'tall' ? styles.menuThumb : styles.productThumb,
        { backgroundColor: colors.card },
      ]}>
      <Image
        source={{ uri: imageUrl(path) ?? undefined }}
        style={StyleSheet.absoluteFill}
        contentFit={shape === 'square' ? 'contain' : 'cover'}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Remove photo"
        onPress={onRemove}
        style={[styles.removeBadge, { backgroundColor: colors.hero }]}>
        <Text style={[styles.removeBadgeText, { color: colors.heroText }]}>✕</Text>
      </Pressable>
    </View>
  );
}

function confirmRemove(title: string, run: () => Promise<void>) {
  Alert.alert(title, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => void run() },
  ]);
}

/** Logo, venue photos and menu photos. */
function Media({ store, onChanged }: { store: AdminStore; onChanged: () => void }) {
  const colors = usePalette();
  const [busy, setBusy] = useState<'logo' | 'venue' | 'menu' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const add = async (kind: 'logo' | 'venue' | 'menu') => {
    const uri = await pickImage();
    if (!uri) return;
    setBusy(kind);
    setStatus(null);
    const result = await setStoreImage(store, uri, kind);
    setBusy(null);
    if (result.ok) onChanged();
    else setStatus({ tone: 'error', title: 'NOT UPLOADED', text: result.message });
  };

  const remove = (path: string) =>
    confirmRemove('Remove this image?', async () => {
      const result = await removeStoreImage(store, path);
      if (result.ok) onChanged();
      else setStatus({ tone: 'error', title: 'NOT REMOVED', text: result.message });
    });

  return (
    <>
      <SectionTitle>LOGO</SectionTitle>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Square, ideally a PNG with a transparent background. Shown on Find your ritual and the café page.
      </Text>
      <View style={styles.thumbRow}>
        {store.logo_path && <Thumb path={store.logo_path} shape="square" onRemove={() => remove(store.logo_path!)} />}
        {busy === 'logo' && <ActivityIndicator />}
      </View>
      <SecondaryButton label={store.logo_path ? 'REPLACE LOGO' : 'CHOOSE LOGO'} onPress={() => void add('logo')} />

      <SectionTitle>{`VENUE PHOTOS (${store.venue_image_paths.length}/${MAX_VENUE_PHOTOS})`}</SectionTitle>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Storefront, interior or counter, landscape. Shown at the top of the café page.
      </Text>
      <View style={styles.thumbRow}>
        {store.venue_image_paths.map((path) => (
          <Thumb key={path} path={path} shape="wide" onRemove={() => remove(path)} />
        ))}
        {busy === 'venue' && <ActivityIndicator />}
      </View>
      {store.venue_image_paths.length < MAX_VENUE_PHOTOS && (
        <SecondaryButton label="ADD VENUE PHOTO" onPress={() => void add('venue')} />
      )}

      <SectionTitle>{`MENU (${store.menu_image_paths.length}/${MAX_MENU_PHOTOS})`}</SectionTitle>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        A clear photo or screenshot of each menu page. Runners can open it full screen.
      </Text>
      <View style={styles.thumbRow}>
        {store.menu_image_paths.map((path) => (
          <Thumb key={path} path={path} shape="tall" onRemove={() => remove(path)} />
        ))}
        {busy === 'menu' && <ActivityIndicator />}
      </View>
      {store.menu_image_paths.length < MAX_MENU_PHOTOS && (
        <SecondaryButton label="ADD MENU PAGE" onPress={() => void add('menu')} />
      )}
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Only use images the café has given you or approved.
      </Text>
      <StatusNotice status={status} />
    </>
  );
}

function ProductRow({ store, product, index, onChanged }: {
  store: AdminStore;
  product: AdminProduct;
  index: number;
  onChanged: () => void;
}) {
  const colors = usePalette();
  const [name, setName] = useState(product.name);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const last = index === store.store_products.length - 1;

  const run = async (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    setStatus(null);
    const result = await action();
    setBusy(false);
    if (result.ok) onChanged();
    else setStatus({ tone: 'error', title: 'NOT SAVED', text: result.message ?? 'Please try again.' });
  };

  const changePhoto = async () => {
    const uri = await pickImage();
    if (uri) await run(() => setProductImage(store, product, uri));
  };

  return (
    <View style={[styles.productCard, { backgroundColor: colors.surface }]}>
      <View style={styles.productTop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={product.image_path ? 'Replace product photo' : 'Add product photo'}
          onPress={() => void changePhoto()}
          style={[styles.productThumb, { backgroundColor: colors.card }]}>
          {product.image_path ? (
            <Image source={{ uri: imageUrl(product.image_path) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="contain" />
          ) : (
            <Text style={[styles.addPhotoText, { color: colors.textMuted }]}>+ Photo</Text>
          )}
          {busy && (
            <View style={styles.busyOverlay}>
              <ActivityIndicator />
            </View>
          )}
        </Pressable>
        <View style={styles.productInfo}>
          <Text style={[styles.signatureLabel, { color: colors.textMuted }]}>
            {index === 0 ? 'SIGNATURE · SHOWN ON HOME' : `#${index + 1}`}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            onEndEditing={() => {
              if (name.trim() && name.trim() !== product.name) void run(() => renameProduct(product, name));
            }}
            maxLength={60}
            accessibilityLabel="Product name"
            style={[styles.productNameInput, { color: colors.text, borderColor: colors.border }]}
          />
        </View>
      </View>
      <View style={styles.productActions}>
        <Pressable
          accessibilityRole="button"
          disabled={index === 0 || busy}
          onPress={() => void run(() => moveProduct(store, product, -1))}
          hitSlop={6}>
          <Text style={[styles.productAction, { color: colors.text, opacity: index === 0 ? 0.3 : 1 }]}>↑ Up</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={last || busy}
          onPress={() => void run(() => moveProduct(store, product, 1))}
          hitSlop={6}>
          <Text style={[styles.productAction, { color: colors.text, opacity: last ? 0.3 : 1 }]}>↓ Down</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => confirmRemove(`Remove “${product.name}”?`, () => run(() => removeProduct(product)))}
          hitSlop={6}>
          <Text style={[styles.productAction, styles.dangerText, { color: colors.textMuted }]}>Remove</Text>
        </Pressable>
      </View>
      <StatusNotice status={status} />
    </View>
  );
}

/** The café's best products: name + photo, best first. */
function Products({ store, onChanged }: { store: AdminStore; onChanged: () => void }) {
  const colors = usePalette();
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const full = store.store_products.length >= MAX_PRODUCTS;

  const add = async () => {
    setBusy(true);
    setStatus(null);
    const result = await addProduct(store, name, photo);
    setBusy(false);
    if (!result.ok) {
      setStatus({ tone: 'error', title: 'NOT ADDED', text: result.message });
      return;
    }
    setName('');
    setPhoto(null);
    onChanged();
  };

  return (
    <>
      <SectionTitle>{`BEST PRODUCTS (${store.store_products.length}/${MAX_PRODUCTS})`}</SectionTitle>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Just the highlights, not the whole menu. The first one is the café’s signature and appears on Home.
        Photos work best as PNGs with a transparent background.
      </Text>
      {store.store_products.map((product, index) => (
        <ProductRow key={product.id} store={store} product={product} index={index} onChanged={onChanged} />
      ))}
      {!full && (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Add a product</Text>
          <TextField label="Product name" value={name} onChangeText={setName} maxLength={60} placeholder="Iced matcha latte" />
          <View style={styles.thumbRow}>
            {photo && (
              <View style={[styles.productThumb, { backgroundColor: colors.card }]}>
                <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="contain" />
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={async () => setPhoto((await pickImage()) ?? photo)}
              hitSlop={8}>
              <Text style={[styles.productAction, { color: colors.text }]}>
                {photo ? 'Change photo' : '+ Choose photo (optional)'}
              </Text>
            </Pressable>
          </View>
          <StatusNotice status={status} />
          <PrimaryButton label="ADD PRODUCT" onPress={() => void add()} loading={busy} disabled={!name.trim()} />
        </View>
      )}
    </>
  );
}

/** Add or edit a café. Changes are checked by the database (admin + two-step). */
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
            label="Opening hours (optional)"
            value={fields.opening_hours ?? ''}
            onChangeText={(t) => set('opening_hours', t)}
            maxLength={120}
            placeholder="Mon–Fri 6:30–16:00 · Sat 7:00–13:00"
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

              <Products store={store} onChanged={() => void load()} />
              <Media store={store} onChanged={() => void load()} />

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
    width: 88,
    height: 88,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuThumb: {
    width: 84,
    height: 112,
    borderRadius: 14,
    overflow: 'hidden',
  },
  productCard: {
    borderRadius: 22,
    padding: 12,
    gap: Spacing.two,
  },
  productTop: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  productInfo: {
    flex: 1,
    gap: 4,
  },
  signatureLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  productNameInput: {
    fontSize: 16,
    fontWeight: '600',
    borderBottomWidth: 1,
    paddingVertical: 6,
  },
  productActions: {
    flexDirection: 'row',
    gap: Spacing.four,
  },
  productAction: {
    fontSize: 14,
    fontWeight: '600',
  },
  addPhotoText: {
    fontSize: 13,
    fontWeight: '600',
  },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
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
