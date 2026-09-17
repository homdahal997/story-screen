import { colors, spacing } from '@/src/design-system/tokens';
import * as api from '@/src/services/api';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

const sceneOptions = [3, 4, 5, 6];

const stylePresets = [
  { id: 'Live-Action Film', name: 'Live-Action Film', image: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=160&q=70' },
  { id: 'American Illustration Style', name: 'American Illustration', image: 'https://images.unsplash.com/photo-1614851099511-773084f6911d?w=160&q=70' },
  { id: 'Japanese Anime Style', name: 'Japanese Anime', image: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=160&q=70' },
  { id: 'Korean Manhwa Style', name: 'Korean Manhwa', image: 'https://images.unsplash.com/photo-1620428268482-cf1851a36764?w=160&q=70' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  idea: string;
}

export default function CreateWorkSheet({ visible, onClose, idea }: Props) {
  const [title, setTitle] = useState('');
  const [sceneCount, setSceneCount] = useState(4);
  const [ratio, setRatio] = useState<'landscape' | 'portrait'>('portrait');
  const [style, setStyle] = useState('Live-Action Film');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    if (!idea.trim()) {
      setError('Please enter a story idea first.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const project = await api.createProject({
        title: title.trim(),
        prompt: idea.trim(),
        orientation: ratio === 'portrait' ? 'vertical' : 'horizontal',
        art_style: style,
        scene_count: sceneCount,
      });
      onClose();
      router.push({ pathname: '/create/pipeline', params: { projectId: project.id } });
    } catch (e: any) {
      setError(e?.message || 'Could not create the project.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#1C1C1E', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '88%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: `${colors.fog}22` }}>
            <View style={{ width: 24 }} />
            <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>Create Work</Text>
            <Pressable testID="worksheet-close" onPress={onClose}>
              <Text style={{ color: colors.bone, fontSize: 20 }}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.fog, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg }}>
              Fill in the basics. AI generates the story and video — you&apos;re the director.
            </Text>

            <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm }}>Title (optional)</Text>
            <View style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between' }}>
              <TextInput
                testID="worksheet-title-input"
                value={title}
                onChangeText={setTitle}
                placeholder="AI will name it for you"
                placeholderTextColor={colors.fog}
                style={{ color: colors.bone, fontSize: 14, flex: 1 }}
                maxLength={60}
              />
              <Text style={{ color: colors.fog, fontSize: 12 }}>{title.length}/60</Text>
            </View>

            <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginTop: spacing.lg, marginBottom: spacing.sm }}>Number of Scenes</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {sceneOptions.map((n) => (
                <Pressable
                  key={n}
                  testID={`scene-option-${n}`}
                  onPress={() => setSceneCount(n)}
                  style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 20, backgroundColor: sceneCount === n ? colors.bone : colors.graphite }}
                >
                  <Text style={{ color: sceneCount === n ? colors.ink : colors.bone, fontSize: 14, fontWeight: '600' }}>{n}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginTop: spacing.lg, marginBottom: spacing.sm }}>Video Ratio</Text>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Pressable testID="ratio-portrait" onPress={() => setRatio('portrait')} style={{ flex: 1, backgroundColor: colors.graphite, borderRadius: 12, padding: spacing.md, borderWidth: 2, borderColor: ratio === 'portrait' ? '#8B5CF6' : 'transparent' }}>
                <View style={{ width: 28, height: 48, backgroundColor: '#8B5CF6', borderRadius: 4, marginBottom: spacing.sm }} />
                <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600' }}>Portrait</Text>
                <Text style={{ color: colors.fog, fontSize: 12 }}>9:16</Text>
              </Pressable>
              <Pressable testID="ratio-landscape" onPress={() => setRatio('landscape')} style={{ flex: 1, backgroundColor: colors.graphite, borderRadius: 12, padding: spacing.md, borderWidth: 2, borderColor: ratio === 'landscape' ? '#8B5CF6' : 'transparent' }}>
                <View style={{ width: 48, height: 28, backgroundColor: '#8B5CF6', borderRadius: 4, marginBottom: spacing.sm }} />
                <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600' }}>Landscape</Text>
                <Text style={{ color: colors.fog, fontSize: 12 }}>16:9</Text>
              </Pressable>
            </View>

            <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginTop: spacing.lg, marginBottom: spacing.sm }}>Select Style</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
              {stylePresets.map((s) => (
                <Pressable key={s.id} testID={`style-${s.id}`} onPress={() => setStyle(s.id)} style={{ marginRight: spacing.md, alignItems: 'center', width: 80 }}>
                  <Image source={{ uri: s.image }} style={{ width: 70, height: 90, borderRadius: 8, borderWidth: 2, borderColor: style === s.id ? '#8B5CF6' : 'transparent' }} />
                  <Text style={{ color: colors.bone, fontSize: 10, textAlign: 'center', marginTop: spacing.xs }} numberOfLines={2}>{s.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {error ? <Text style={{ color: colors.signal, fontSize: 12, marginBottom: spacing.sm }}>{error}</Text> : null}
          </ScrollView>

          <View style={{ padding: spacing.lg }}>
            <Pressable
              testID="start-creating-button"
              disabled={submitting}
              onPress={start}
              style={{ backgroundColor: '#8B5CF6', paddingVertical: spacing.md, borderRadius: 24, alignItems: 'center', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? <ActivityIndicator color={colors.bone} /> : <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Start Creating</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
