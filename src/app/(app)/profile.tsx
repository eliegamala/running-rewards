import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useSyncExternalStore } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileAvatar } from '@/components/profile-avatar';
import { Fonts, Palette, type PaletteColors, Spacing } from '@/constants/theme';
import { formatClockTime } from '@/hooks/use-reward-credit';
import { getAuthState, logOut, subscribe as subscribeToAuth } from '@/lib/auth';
import { getStravaState, subscribe as subscribeToStrava } from '@/lib/strava';
import {
  canReceiveRemotePush,
  getNotificationPermission,
  openNotificationSettingsOrAsk,
  subscribe as subscribeToNotifications,
} from '@/lib/notifications';
import {
  canHaveProfilePhoto,
  DISPLAY_NAME_MAX,
  getProfile,
  removeProfilePhoto,
  setDisplayName,
  setProfilePhoto,
  subscribe as subscribeToProfile,
  type ProfileResult,
} from '@/lib/profile';
import { REWARD_DISTANCE_KM } from '@/lib/reward-credit';
import {
  getRewardHistory,
  getRewardTotals,
  subscribe as subscribeToHistory,
} from '@/lib/reward-history';

const RECENT_LIMIT = 10;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} · ${formatClockTime(timestamp)}`;
}

function confirmLogOut() {
  Alert.alert('Log out?', 'You can log back in any time with your email and password.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Log out', style: 'destructive', onPress: () => logOut() },
  ]);
}

function reportIfFailed(result: ProfileResult) {
  if (!result.ok) Alert.alert('Not saved', result.message);
}

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: 'images',
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.8,
};

async function pickPhoto(source: 'camera' | 'library') {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera is off', 'Allow camera access in Settings to take a profile photo.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
  const asset = result.canceled ? null : result.assets?.[0];
  if (asset) reportIfFailed(await setProfilePhoto(asset.uri));
}

function confirmRemovePhoto() {
  Alert.alert('Remove profile photo?', 'Your initials will show instead.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => reportIfFailed(await removeProfilePhoto()) },
  ]);
}

/** Take / choose / remove. Android alerts allow three buttons; tapping outside cancels. */
function openPhotoMenu(hasPhoto: boolean) {
  if (Platform.OS === 'ios') {
    const options = ['Take photo', 'Choose from library', ...(hasPhoto ? ['Remove photo'] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Profile photo',
        options,
        cancelButtonIndex: options.length - 1,
        destructiveButtonIndex: hasPhoto ? 2 : undefined,
      },
      (index) => {
        if (index === 0) void pickPhoto('camera');
        else if (index === 1) void pickPhoto('library');
        else if (hasPhoto && index === 2) confirmRemovePhoto();
      },
    );
    return;
  }
  Alert.alert(
    'Profile photo',
    undefined,
    [
      ...(hasPhoto ? [{ text: 'Remove', style: 'destructive' as const, onPress: confirmRemovePhoto }] : []),
      { text: 'Take photo', onPress: () => void pickPhoto('camera') },
      { text: 'Choose photo', onPress: () => void pickPhoto('library') },
    ],
    { cancelable: true },
  );
}

function Stat({ value, label, colors }: { value: number; label: string; colors: PaletteColors }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.heroText }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.heroMuted }]}>{label}</Text>
    </View>
  );
}

type SettingRowProps = {
  title: string;
  detail: string;
  action: string;
  onPress: () => void;
  colors: PaletteColors;
};

function SettingRow({ title, detail, action, onPress, colors }: SettingRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: colors.border },
        pressed && styles.pressed,
      ]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowName, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.rowMeta, { color: colors.textMuted }]}>{detail}</Text>
      </View>
      <Text style={[styles.settingAction, { color: colors.text }]}>{action}</Text>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const profile = useSyncExternalStore(subscribeToProfile, getProfile);
  const history = useSyncExternalStore(subscribeToHistory, getRewardHistory);
  const totals = useSyncExternalStore(subscribeToHistory, getRewardTotals);
  const auth = useSyncExternalStore(subscribeToAuth, getAuthState);
  const strava = useSyncExternalStore(subscribeToStrava, getStravaState);
  const notificationPermission = useSyncExternalStore(
    subscribeToNotifications,
    getNotificationPermission,
  );
  const alertsDetail =
    notificationPermission === 'granted'
      ? canReceiveRemotePush()
        ? 'On'
        : 'On for this phone (Strava alerts need the full app build)'
      : notificationPermission === 'denied'
        ? 'Off — turn on in Settings'
        : notificationPermission === 'unavailable'
          ? 'Not available on this device'
          : 'Get told when a run unlocks a reward';
  const stravaDetail = {
    connected: 'Connected',
    not_connected: 'Not connected',
    revoked: 'Reconnect needed',
    error: 'Status unavailable',
    unknown: 'Checking…',
    unavailable: 'Needs a signed-in account',
  }[strava.status];

  const photoEditable = canHaveProfilePhoto();
  // All-time counts from the server (history below shows only the most recent credits).
  const { earned, redeemed } = totals;
  const recent = history
    .filter((entry) => entry.status !== 'unlocked')
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, RECENT_LIMIT);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.canvas }]}
      edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => router.navigate('/')} hitSlop={12}>
          <Text style={[styles.backText, { color: colors.textMuted }]}>‹ Home</Text>
        </Pressable>

        {/* Runner identity */}
        <View style={styles.identity}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={profile.avatarUrl ? 'Change profile photo' : 'Add profile photo'}
            disabled={!photoEditable || profile.avatarBusy}
            onPress={() => openPhotoMenu(profile.avatarPath !== null)}
            style={({ pressed }) => pressed && styles.pressed}>
            <ProfileAvatar size={76} colors={colors}>
              {profile.avatarBusy && (
                <View style={styles.avatarBusy}>
                  <ActivityIndicator color={colors.heroText} />
                </View>
              )}
            </ProfileAvatar>
          </Pressable>
          <View style={styles.identityText}>
            <Text style={[styles.label, { color: colors.textMuted }]}>PROFILE</Text>
            {/* Keyed on the saved name so the field follows the account (and a failed save reverts). */}
            <TextInput
              key={profile.displayName}
              defaultValue={profile.displayName}
              placeholder="Add your name"
              placeholderTextColor={colors.textMuted}
              onEndEditing={async (event) =>
                reportIfFailed(await setDisplayName(event.nativeEvent.text))
              }
              maxLength={DISPLAY_NAME_MAX}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              accessibilityLabel="Display name"
              style={[styles.nameInput, { color: colors.text }]}
            />
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {photoEditable ? 'Tap your photo or name to edit' : 'Tap your name to edit'}
            </Text>
          </View>
        </View>

        {/* Reward stats */}
        <View style={[styles.statsCard, { backgroundColor: colors.hero }]}>
          <Stat value={earned} label="Rewards earned" colors={colors} />
          <View style={styles.statDivider} />
          <Stat value={redeemed} label="Rewards redeemed" colors={colors} />
        </View>

        {/* Recent rewards */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>RECENT REWARDS</Text>
        {recent.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No rewards yet</Text>
            <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
              Run {REWARD_DISTANCE_KM} km to unlock your first reward.
            </Text>
          </View>
        ) : (
          recent.map((entry) => {
            const isRedeemed = entry.status === 'redeemed';
            return (
              <View key={entry.id} style={[styles.row, { borderTopColor: colors.border }]}>
                <View style={styles.rowText}>
                  <Text style={[styles.rowName, { color: colors.text }]}>
                    {entry.storeName ?? 'No spot chosen'}
                  </Text>
                  <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
                    {entry.reward ?? 'Expired before use'}
                  </Text>
                  {entry.endedAt !== null && (
                    <Text style={[styles.rowDate, { color: colors.textMuted }]}>
                      {formatDate(entry.endedAt)}
                    </Text>
                  )}
                </View>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: isRedeemed ? colors.accent : colors.surface },
                  ]}>
                  <Text
                    style={[
                      styles.pillText,
                      { color: isRedeemed ? colors.accentText : colors.textMuted },
                    ]}>
                    {isRedeemed ? 'REDEEMED' : 'EXPIRED'}
                  </Text>
                </View>
              </View>
            );
          })
        )}

        {/* Settings: only things that work today */}
        {/* Account: only what Supabase has confirmed */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>ACCOUNT</Text>
        {auth.devPreview ? (
          <SettingRow
            title="Preview mode"
            detail="No account. Development only."
            action="Exit"
            onPress={() => logOut()}
            colors={colors}
          />
        ) : (
          <SettingRow
            title="Signed in"
            detail={auth.email ?? 'Your account'}
            action="Log out"
            onPress={confirmLogOut}
            colors={colors}
          />
        )}
        <SettingRow
          title="Strava"
          detail={stravaDetail}
          action={strava.status === 'connected' ? 'View ›' : 'Connect ›'}
          onPress={() => router.push('/strava')}
          colors={colors}
        />
        {!auth.devPreview && (
          <SettingRow
            title="Delete account"
            detail="Permanently delete your account and rewards"
            action="Delete ›"
            onPress={() => router.push('/delete-account')}
            colors={colors}
          />
        )}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>SETTINGS</Text>
        <SettingRow
          title="Reward alerts"
          detail={alertsDetail}
          action={notificationPermission === 'undetermined' ? 'Turn on ›' : 'Settings ›'}
          onPress={() => void openNotificationSettingsOrAsk()}
          colors={colors}
        />
        <SettingRow
          title="Location access"
          detail="Used to measure your runs"
          action="Open Settings ›"
          onPress={() => Linking.openSettings()}
          colors={colors}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  pressed: {
    opacity: 0.7,
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },

  // Identity
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.four,
  },
  avatarBusy: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  identityText: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  nameInput: {
    fontSize: 30,
    fontWeight: '400',
    letterSpacing: -0.8,
    paddingVertical: 2,
  },
  hint: {
    fontSize: 12,
  },

  // Stats
  statsCard: {
    flexDirection: 'row',
    borderRadius: 28,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.four,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(246, 242, 200, 0.2)',
  },
  statValue: {
    fontFamily: Fonts.rounded,
    fontSize: 36,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: Spacing.one,
  },

  // Lists
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 40,
    marginBottom: Spacing.two,
  },
  emptyCard: {
    borderRadius: 24,
    padding: Spacing.four,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 17,
    fontWeight: '500',
  },
  rowMeta: {
    fontSize: 14,
    marginTop: 2,
  },
  rowDate: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  settingAction: {
    fontSize: 14,
    fontWeight: '600',
  },
});
