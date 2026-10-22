import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { mapsUrlFor, type StoreLocation } from '@/lib/stores';

async function openGoogleMaps(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Couldn't open Google Maps", 'Please try again in a moment.');
  }
}

type StoreLocationDetailsProps = {
  location: StoreLocation;
  textColor: string;
  mutedColor: string;
  /** `pass` for the dark reward pass, `row` for the subtle Rewards list. */
  variant: 'pass' | 'row';
  /** Outline colour for the pass button. */
  borderColor?: string;
};

/** Where a reward can be redeemed, with a Google Maps link once there is an address. */
export function StoreLocationDetails({
  location,
  textColor,
  mutedColor,
  variant,
  borderColor,
}: StoreLocationDetailsProps) {
  const isPass = variant === 'pass';
  const googleMapsUrl = mapsUrlFor(location);

  return (
    <View style={isPass ? styles.passContainer : styles.rowContainer}>
      <Text style={[isPass ? styles.passName : styles.rowName, { color: textColor }]}>
        📍 {location.name ?? location.address}
      </Text>
      {location.name !== null && (
        <Text style={[isPass ? styles.passAddress : styles.rowAddress, { color: mutedColor }]}>
          {location.address}
        </Text>
      )}

      {googleMapsUrl && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`View ${location.name ?? 'location'} on Google Maps`}
          onPress={() => openGoogleMaps(googleMapsUrl)}
          hitSlop={isPass ? undefined : 8}
          style={({ pressed }) => [
            isPass ? [styles.passButton, { borderColor }] : styles.rowButton,
            pressed && styles.pressed,
          ]}>
          <Text style={[isPass ? styles.passButtonText : styles.rowButtonText, { color: textColor }]}>
            VIEW ON GOOGLE MAPS →
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  passContainer: {
    marginTop: Spacing.four,
  },
  passName: {
    fontSize: 17,
    fontWeight: '600',
  },
  passAddress: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 2,
  },
  passButton: {
    alignSelf: 'flex-start',
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  passButtonText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  rowContainer: {
    marginTop: 6,
  },
  rowName: {
    fontSize: 13,
    fontWeight: '500',
  },
  rowAddress: {
    fontSize: 13,
    marginTop: 1,
  },
  rowButton: {
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  rowButtonText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
