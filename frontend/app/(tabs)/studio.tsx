import CreateWorkSheet from '@/src/components/CreateWorkSheet';
import { colors, spacing, typography } from '@/src/design-system/tokens';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

const hitScripts = [
  {
    id: '01',
    title: 'Ward of Hearts',
    genres: ['Suspense', 'Thriller'],
    reason: 'A chilling psychological thriller where every night is a fight for survival, and every rule could mean life or death.',
    poster: 'https://picsum.photos/seed/ward/120/160',
  },
  {
    id: '02',
    title: 'Brides in Smoke',
    genres: ['Revenge', 'Marriage'],
    reason: 'One of today\'s hottest revenge dramas, loved for its emotional twists, powerful heroines, and addictive storytelling.',
    poster: 'https://picsum.photos/seed/brides/120/160',
  },
  {
    id: '03',
    title: 'My Repairman Dad Is the Mecha God',
    genres: ['Sci-Fi', 'Hero Returns'],
    reason: 'An epic sci-fi action drama where a forgotten hero unleashes his true power to protect his family.',
    poster: 'https://picsum.photos/seed/mecha/120/160',
  },
];

export default function Studio() {
  const [mode, setMode] = useState<'inspiration' | 'adaptation'>('inspiration');
  const [idea, setIdea] = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.ink }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
      
      {/* Hero */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.bone, fontSize: 28, fontWeight: '700' }}>
            Create with AI
          </Text>
          <Text style={{ color: colors.fog, fontSize: typography.body.fontSize, marginTop: spacing.xs }}>
            Turn your ideas into amazing dramas{'\n'}and <Text style={{ color: colors.bone, fontWeight: '600' }}>unlock earning opportunities</Text>
          </Text>
        </View>
        <Image
          source={{ uri: 'https://picsum.photos/seed/hero/100/100' }}
          style={{ width: 80, height: 80, borderRadius: 40 }}
        />
      </View>

      {/* Mode Toggle — Pill Buttons */}
      <View style={{ flexDirection: 'row', marginTop: spacing.lg, gap: spacing.sm }}>
        <Pressable
          onPress={() => setMode('inspiration')}
          style={{
            flex: 1,
            paddingVertical: spacing.sm,
            borderRadius: 20,
            backgroundColor: mode === 'inspiration' ? '#8B5CF6' : colors.graphite,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.bone, fontWeight: '600', fontSize: 14 }}>
            Inspiration Mode
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('adaptation')}
          style={{
            flex: 1,
            paddingVertical: spacing.sm,
            borderRadius: 20,
            backgroundColor: mode === 'adaptation' ? '#8B5CF6' : colors.graphite,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.bone, fontWeight: '600', fontSize: 14 }}>
            Novel Adaptation
          </Text>
        </Pressable>
      </View>

      {/* Story Input Card */}
      <View style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginTop: spacing.lg }}>
        <TextInput
          value={idea}
          onChangeText={setIdea}
          testID="studio-idea-input"
          placeholder="Write down your story idea. AI will expand it into a full plot."
          placeholderTextColor={colors.fog}
          multiline
          style={{
            color: colors.bone,
            fontSize: typography.body.fontSize,
            minHeight: 100,
            textAlignVertical: 'top',
          }}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
          <Pressable style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: `${colors.fog}22`, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 12 }}>
            <Text style={{ color: colors.bone, fontSize: 12 }}>💡 Random inspiration</Text>
          </Pressable>
          <Text style={{ color: colors.fog, fontSize: 12 }}>{idea.length}/20000</Text>
        </View>
      </View>

      {/* Inspiration Example */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
        <Text style={{ color: colors.fog, fontSize: 12 }}>Inspiration Example</Text>
        <Text style={{ color: colors.fog }}>↻</Text>
      </View>
      <Pressable onPress={() => setIdea('Posing as Broke, but the Billionaire CEO Saw Through Me')}>
        <Text style={{ color: colors.bone, fontSize: 13, marginTop: spacing.xs }}>
          Posing as Broke, but the Billionaire CEO Saw Through Me
        </Text>
      </Pressable>

      {/* Next Button */}
      <Pressable
        testID="studio-next-button"
        onPress={() => setSheetVisible(true)}
        style={{
          backgroundColor: '#8B5CF6',
          paddingVertical: spacing.md,
          borderRadius: 8,
          alignItems: 'center',
          marginTop: spacing.lg,
        }}
      >
        <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Next</Text>
      </Pressable>

      {/* Hit Scripts */}
      <View style={{ marginTop: spacing.xxl }}>
        <Text style={{ color: colors.bone, fontSize: 20, fontWeight: '700' }}>
          🔥 Hit Scripts
        </Text>
        <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.xs }}>
          Remake for higher release chances, more exposure & earnings.
        </Text>

        {hitScripts.map((script) => (
          <View key={script.id} style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: 'row' }}>
              <Image
                source={{ uri: script.poster }}
                style={{ width: 70, height: 95, borderRadius: 4 }}
                contentFit="cover"
              />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700' }}>
                  {script.title}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                  {script.genres.map((tag) => (
                    <View key={tag} style={{ backgroundColor: `${colors.fog}22`, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 10 }}>
                      <Text style={{ color: colors.fog, fontSize: 10 }}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Pressable
                onPress={() => setIdea(`${script.title} — ${script.reason}`)}
                style={{ backgroundColor: '#8B5CF6', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14, alignSelf: 'flex-start' }}
              >
                <Text style={{ color: colors.bone, fontWeight: '600', fontSize: 12 }}>Remake</Text>
              </Pressable>
            </View>
            <View style={{ backgroundColor: `${colors.graphite}`, padding: spacing.sm, marginTop: spacing.sm, borderRadius: 4 }}>
              <Text style={{ color: colors.fog, fontSize: 11, fontWeight: '700', marginBottom: spacing.xs }}>Why Recommended</Text>
              <Text style={{ color: colors.bone, fontSize: 12, lineHeight: 18 }}>{script.reason}</Text>
            </View>
          </View>
        ))}

        <Text style={{ color: colors.fog, textAlign: 'center', marginTop: spacing.xl }}>No more data~</Text>
      </View>
      <CreateWorkSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} idea={idea} />
    </ScrollView>
  );
}
