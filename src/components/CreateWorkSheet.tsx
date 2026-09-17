import { colors, spacing } from '@/src/design-system/tokens';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

const episodeOptions = ['10Eps', '45Eps', '60Eps', 'Custom'];

const styles = [
  { id: 'live', name: 'Live-Action Film', image: 'https://picsum.photos/seed/live/80/100' },
  { id: 'american', name: 'American Illustration Style', image: 'https://picsum.photos/seed/american/80/100' },
  { id: 'anime', name: 'Japanese Anime Style', image: 'https://picsum.photos/seed/anime/80/100' },
  { id: 'manhwa', name: 'Korean Manhwa Style', image: 'https://picsum.photos/seed/manhwa/80/100' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  idea: string;
}

export default function CreateWorkSheet({ visible, onClose, idea }: Props) {
  const [title, setTitle] = useState('');
  const [episodes, setEpisodes] = useState('10Eps');
  const [ratio, setRatio] = useState<'landscape' | 'portrait'>('portrait');
  const [style, setStyle] = useState('live');

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#1C1C1E', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' }}>
          
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: `${colors.fog}22` }}>
            <View style={{ width: 24 }} />
            <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>Create Work</Text>
            <Pressable onPress={onClose}>
              <Text style={{ color: colors.bone, fontSize: 20 }}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={{ padding: spacing.lg }}>
            
            {/* Subtitle */}
            <Text style={{ color: colors.fog, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg }}>
              Fill in the basics. AI generates the story and video — you're the director.
            </Text>

            {/* Title Input */}
            <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm }}>Title</Text>
            <View style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between' }}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="The Shadow Keeper"
                placeholderTextColor={colors.fog}
                style={{ color: colors.bone, fontSize: 14, flex: 1 }}
                maxLength={70}
              />
              <Text style={{ color: colors.fog, fontSize: 12 }}>{title.length}/70</Text>
            </View>

            {/* Total Episodes */}
            <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginTop: spacing.lg, marginBottom: spacing.sm }}>Total Episodes</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {episodeOptions.map((ep) => (
                <Pressable
                  key={ep}
                  onPress={() => setEpisodes(ep)}
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    borderRadius: 20,
                    backgroundColor: episodes === ep ? colors.bone : colors.graphite,
                  }}
                >
                  <Text style={{ color: episodes === ep ? colors.ink : colors.bone, fontSize: 13, fontWeight: '600' }}>{ep}</Text>
                </Pressable>
              ))}
            </View>

            {/* Video Ratio */}
            <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginTop: spacing.lg, marginBottom: spacing.sm }}>Video Ratio</Text>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Pressable
                onPress={() => setRatio('landscape')}
                style={{
                  flex: 1,
                  backgroundColor: colors.graphite,
                  borderRadius: 12,
                  padding: spacing.md,
                  borderWidth: 2,
                  borderColor: ratio === 'landscape' ? '#8B5CF6' : 'transparent',
                }}
              >
                <View style={{ width: 48, height: 28, backgroundColor: '#8B5CF6', borderRadius: 4, marginBottom: spacing.sm }} />
                <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600' }}>Landscape</Text>
                <Text style={{ color: colors.fog, fontSize: 12 }}>16:9</Text>
              </Pressable>
              <Pressable
                onPress={() => setRatio('portrait')}
                style={{
                  flex: 1,
                  backgroundColor: colors.graphite,
                  borderRadius: 12,
                  padding: spacing.md,
                  borderWidth: 2,
                  borderColor: ratio === 'portrait' ? '#8B5CF6' : 'transparent',
                }}
              >
                <View style={{ width: 28, height: 48, backgroundColor: '#8B5CF6', borderRadius: 4, marginBottom: spacing.sm }} />
                <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600' }}>Portrait</Text>
                <Text style={{ color: colors.fog, fontSize: 12 }}>9:16</Text>
              </Pressable>
            </View>

            {/* Select Style */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm }}>
              <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600' }}>Select Style</Text>
              <Pressable>
                <Text style={{ color: colors.fog, fontSize: 12 }}>View All &gt;</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.xl }}>
              {styles.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => setStyle(s.id)}
                  style={{ marginRight: spacing.md, alignItems: 'center', width: 80 }}
                >
                  <Image
                    source={{ uri: s.image }}
                    style={{
                      width: 70,
                      height: 90,
                      borderRadius: 8,
                      borderWidth: 2,
                      borderColor: style === s.id ? '#8B5CF6' : 'transparent',
                    }}
                  />
                  <Text style={{ color: colors.bone, fontSize: 10, textAlign: 'center', marginTop: spacing.xs }} numberOfLines={2}>{s.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

          </ScrollView>

          {/* Start Creating Button */}
          <View style={{ padding: spacing.lg }}>
            <Pressable
              onPress={() => {
                const episodeCount = episodes === 'Custom' ? '60' : episodes.replace('Eps', '');
                onClose();
                router.push({
                  pathname: '/create/assets',
                  params: { id: Date.now().toString(), title: title || 'Untitled', episodes: episodeCount },
                });
              }}
              style={{
                backgroundColor: '#8B5CF6',
                paddingVertical: spacing.md,
                borderRadius: 24,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Start Creating</Text>
            </Pressable>
          </View>

        </View>
      </View>
    </Modal>
  );
}
