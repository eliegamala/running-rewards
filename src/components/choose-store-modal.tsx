import { useRef, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';

import {
  CelebrationModal,
  ModalBadge,
  ModalButton,
  modalText,
} from '@/components/celebration-modal';
import { Palette, Spacing } from '@/constants/theme';
import { selectStore } from '@/lib/reward-credit';
import { getCategory, type Store } from '@/lib/stores';

type ChooseStoreModalProps = {
  store: Store;
  onClose: () => void;
  /** Called once the credit is tied to this store, e.g. to open the live pass. */
  onSelected: () => void;
};

/** Confirms which store the single reward credit will be used at. Does not redeem it. */
export function ChooseStoreModal({ store, onClose, onSelected }: ChooseStoreModalProps) {
  const scheme = useColorScheme();
  const colors = Palette[scheme === 'dark' ? 'dark' : 'light'];
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const busyRef = useRef(false);
  const category = getCategory(store.category);

  // The server ties the reward to this store; only its answer counts.
  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNetworkError(false);
    const result = await selectStore(store.id);
    busyRef.current = false;
    setBusy(false);
    if (result.ok) onSelected();
    else if (result.reason === 'network') setNetworkError(true);
    else setUnavailable(true);
  };

  if (unavailable) {
    return (
      <CelebrationModal visible onRequestClose={onClose}>
        <ModalBadge>⌛</ModalBadge>
        <Text style={[modalText.eyebrow, { color: colors.accent }]}>REWARD UNAVAILABLE</Text>
        <Text style={[modalText.title, { color: colors.heroText }]}>
          This one <Text style={modalText.serifItalic}>got away.</Text>
        </Text>
        <Text style={[modalText.copy, { color: colors.heroMuted }]}>
          This reward has expired or has already been used.
        </Text>
        <ModalButton label="OK" onPress={onClose} />
      </CelebrationModal>
    );
  }

  return (
    <CelebrationModal visible onRequestClose={onClose}>
      <ModalBadge>{category.emoji}</ModalBadge>
      <Text style={[modalText.eyebrow, { color: colors.accent }]}>USE YOUR REWARD HERE?</Text>
      <Text style={[modalText.title, { color: colors.heroText }]}>{store.name}</Text>
      <View style={styles.chip}>
        <Text style={[styles.chipText, modalText.serifItalic]}>{store.reward}</Text>
      </View>
      <Text style={[modalText.copy, { color: colors.heroMuted }]}>
        You have one reward. Choosing {store.name} opens a live pass to show when you arrive, and
        the other spots will no longer be available.
      </Text>
      {networkError && (
        <Text style={[modalText.copy, { color: colors.accent }]}>
          Couldn&apos;t reach the server. Check your connection and try again.
        </Text>
      )}
      <ModalButton label={busy ? 'CHOOSING…' : 'USE IT HERE'} onPress={confirm} />
      <ModalButton label="Cancel" variant="secondary" onPress={onClose} />
    </CelebrationModal>
  );
}

const styles = StyleSheet.create({
  chip: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: 'rgba(246, 242, 200, 0.14)',
  },
  chipText: {
    fontSize: 18,
    color: '#F6F2C8',
  },
});
