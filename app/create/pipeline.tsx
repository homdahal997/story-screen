import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { colors, spacing } from '@/src/design-system/tokens';

const steps = ['Synopsis', 'Script', 'Asset', 'Storyboard', 'Preview'];

const synopsisData = {
  title: 'Episode 1: The Contract',
  content: `Chloe, a talented wedding planner, finds herself in desperate circumstances when her brother's gambling debts threaten their family. Marcus Chen, a cold billionaire CEO, proposes an unusual arrangement—a contract marriage that could solve all her problems.

But nothing is as simple as it seems. As Chloe steps into Marcus's world of luxury and secrets, she begins to notice strange occurrences. Whispers about his first wife. Locked rooms in the mansion. And a photograph that shouldn't exist.

The episode ends with Chloe discovering a hidden diary, its pages filled with warnings: "Don't trust him. Run while you still can."`,
};

const scriptScenes = [
  { id: '1', scene: 'INT. WEDDING VENUE - DAY', description: 'Chloe arranges flowers, phone buzzes with threatening messages about debt.' },
  { id: '2', scene: 'INT. CHEN CORPORATION - DAY', description: 'Marcus watches Chloe from his office window, making a calculated decision.' },
  { id: '3', scene: 'INT. COFFEE SHOP - EVENING', description: 'The proposal. Marcus offers the contract. Chloe hesitates.' },
  { id: '4', scene: 'INT. CHEN MANSION - NIGHT', description: 'Chloe enters her new home. Discovers the locked east wing.' },
  { id: '5', scene: 'INT. BEDROOM - NIGHT', description: 'Chloe finds the hidden diary under the floorboards.' },
];

const storyboardShots = [
  { id: '1', shot: 'Wide Shot', description: 'Wedding venue establishing', image: 'https://picsum.photos/seed/shot1/200/120' },
  { id: '2', shot: 'Close Up', description: "Chloe's worried face", image: 'https://picsum.photos/seed/shot2/200/120' },
  { id: '3', shot: 'Over Shoulder', description: 'Marcus watching from window', image: 'https://picsum.photos/seed/shot3/200/120' },
  { id: '4', shot: 'Two Shot', description: 'Contract signing moment', image: 'https://picsum.photos/seed/shot4/200/120' },
  { id: '5', shot: 'POV Shot', description: 'Diary pages revealed', image: 'https://picsum.photos/seed/shot5/200/120' },
  { id: '6', shot: 'Close Up', description: 'Warning text in diary', image: 'https://picsum.photos/seed/shot6/200/120' },
];

export default function Pipeline() {
  const { episodeId, step: initialStep } = useLocalSearchParams<{ episodeId: string; step: string }>();
  const [currentStep, setCurrentStep] = useState(parseInt(initialStep || '1', 10));
  const [generating, setGenerating] = useState(true);
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    setGenerating(true);
    setGenerated(false);
    const timer = setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, [currentStep]);

  const goToNextStep = () => {
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    } else {
      router.replace({
        pathname: '/project/[id]',
        params: { id: '1', title: 'नक़ली विवाह', episodes: '60' },
      });
    }
  };

  const renderStepContent = () => {
    if (generating) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: '#8B5CF6',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: spacing.lg,
            }}
          >
            <ActivityIndicator color={colors.bone} size="large" />
          </View>
          <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '600' }}>
            {currentStep === 1 && 'Creating story outline...'}
            {currentStep === 2 && 'Writing script...'}
            {currentStep === 3 && 'Generating assets...'}
            {currentStep === 4 && 'Building storyboard...'}
            {currentStep === 5 && 'Rendering preview...'}
          </Text>
          <Text style={{ color: colors.fog, fontSize: 14, marginTop: spacing.sm }}>
            Est. time remaining <Text style={{ color: colors.bone, fontWeight: '600' }}>1-2 minutes</Text>
          </Text>
          <Text style={{ color: colors.fog, fontSize: 12, marginTop: spacing.xs }}>AI will keep generating after you exit</Text>
        </View>
      );
    }

    if (currentStep === 1) {
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '700', marginBottom: spacing.md }}>{synopsisData.title}</Text>
          <Text style={{ color: colors.fog, fontSize: 14, lineHeight: 22 }}>{synopsisData.content}</Text>
          <Pressable style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }}>
            <Text style={{ color: '#8B5CF6', fontSize: 14, fontWeight: '600' }}>✎ Edit Synopsis</Text>
          </Pressable>
        </ScrollView>
      );
    }

    if (currentStep === 2) {
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.md }}>Scene Breakdown</Text>
          {scriptScenes.map((scene, index) => (
            <View key={scene.id} style={{ backgroundColor: colors.graphite, padding: spacing.md, borderRadius: 8, marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: '#8B5CF6',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginRight: spacing.sm,
                  }}
                >
                  <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>{index + 1}</Text>
                </View>
                <Text style={{ color: colors.bone, fontSize: 13, fontWeight: '700' }}>{scene.scene}</Text>
              </View>
              <Text style={{ color: colors.fog, fontSize: 13, lineHeight: 20 }}>{scene.description}</Text>
            </View>
          ))}
          <Pressable style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
            <Text style={{ color: '#8B5CF6', fontSize: 14, fontWeight: '600' }}>+ Add Scene</Text>
          </Pressable>
        </ScrollView>
      );
    }

    if (currentStep === 3) {
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg }}>
          <AssetTab />
        </ScrollView>
      );
    }

    if (currentStep === 4) {
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.md }}>Shot List</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            {storyboardShots.map((shot) => (
              <Pressable key={shot.id} style={{ width: '47%' }}>
                <Image source={{ uri: shot.image }} style={{ width: '100%', height: 100, borderRadius: 8 }} contentFit="cover" />
                <View
                  style={{
                    position: 'absolute',
                    top: spacing.xs,
                    left: spacing.xs,
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 2,
                    borderRadius: 4,
                  }}
                >
                  <Text style={{ color: colors.bone, fontSize: 10 }}>{shot.shot}</Text>
                </View>
                <Text style={{ color: colors.fog, fontSize: 11, marginTop: spacing.xs }}>{shot.description}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }}>
            <Text style={{ color: '#8B5CF6', fontSize: 14, fontWeight: '600' }}>+ Add Shot</Text>
          </Pressable>
        </ScrollView>
      );
    }

    if (currentStep === 5) {
      return (
        <View style={{ flex: 1, padding: spacing.lg }}>
          <View
            style={{
              backgroundColor: colors.graphite,
              borderRadius: 12,
              aspectRatio: 9 / 16,
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: spacing.lg,
            }}
          >
            <Image
              source={{ uri: 'https://picsum.photos/seed/preview/300/500' }}
              style={{ width: '100%', height: '100%', borderRadius: 12 }}
              contentFit="cover"
            />
            <View style={{ position: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: 'rgba(139, 92, 246, 0.9)',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: colors.bone, fontSize: 24 }}>▶</Text>
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <Pressable style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 20, marginBottom: spacing.xs }}>🔄</Text>
              <Text style={{ color: colors.fog, fontSize: 12 }}>Regenerate</Text>
            </Pressable>
            <Pressable style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 20, marginBottom: spacing.xs }}>✎</Text>
              <Text style={{ color: colors.fog, fontSize: 12 }}>Edit</Text>
            </Pressable>
            <Pressable style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 20, marginBottom: spacing.xs }}>💾</Text>
              <Text style={{ color: colors.fog, fontSize: 12 }}>Save</Text>
            </Pressable>
          </View>
        </View>
      );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      {/* Header */}
      <View
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, paddingTop: spacing.xl }}
      >
        <Pressable onPress={() => router.replace({ pathname: '/project/[id]', params: { id: '1', title: 'नक़ली विवाह', episodes: '60' } })}>
          <Text style={{ color: colors.bone, fontSize: 20 }}>✕</Text>
        </Pressable>
        <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '600' }}>Episode {episodeId || '1'}</Text>
        <View style={{ width: 20 }} />
      </View>

      {/* Step Progress */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        }}
      >
        {steps.map((step, index) => (
          <View key={step} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: index + 1 <= currentStep ? '#8B5CF6' : 'transparent',
                  borderWidth: index + 1 <= currentStep ? 0 : 1,
                  borderColor: colors.fog,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                {index + 1 < currentStep ? (
                  <Text style={{ color: colors.bone, fontSize: 12 }}>✓</Text>
                ) : (
                  <Text style={{ color: index + 1 <= currentStep ? colors.bone : colors.fog, fontSize: 12, fontWeight: '600' }}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text style={{ color: index + 1 === currentStep ? colors.bone : colors.fog, fontSize: 9, marginTop: spacing.xs }}>
                {step}
              </Text>
            </View>
            {index < steps.length - 1 && (
              <View
                style={{
                  width: 16,
                  height: 1,
                  backgroundColor: index + 1 < currentStep ? '#8B5CF6' : `${colors.fog}44`,
                  marginHorizontal: 2,
                  marginBottom: spacing.md,
                }}
              />
            )}
          </View>
        ))}
      </View>

      {/* Content */}
      {renderStepContent()}

      {/* Bottom Button */}
      <View style={{ padding: spacing.lg, paddingBottom: spacing.xl }}>
        <Pressable
          onPress={goToNextStep}
          disabled={generating}
          style={{
            backgroundColor: generating ? `${colors.fog}44` : '#8B5CF6',
            paddingVertical: spacing.md,
            borderRadius: 24,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>
            {generating ? 'Generating...' : currentStep === 5 ? 'Complete Episode' : `Next: ${steps[currentStep]}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function AssetTab() {
  const [activeTab, setActiveTab] = useState('Characters');
  const assetTabs = ['Characters', 'Scenes', 'Props'];

  const characters = [
    { id: '1', name: 'Chloe', description: 'Young adult woman, 27 years old, chestnut-brown hair, hazel eyes, determined gaze.' },
    { id: '2', name: 'Marcus', description: 'Young adult man, 29 years old, dark brown hair, blue-gray eyes, angular jawline.' },
    { id: '3', name: 'Richard', description: 'Middle-aged man, 58 years old, salt-and-pepper hair, cold gray eyes, gaunt face.' },
  ];

  const scenes = [
    { id: '1', name: 'Wedding Venue', description: 'Elegant indoor venue with white flowers and soft lighting.' },
    { id: '2', name: 'Chen Corporation', description: 'Modern glass skyscraper office with city views.' },
    { id: '3', name: 'Chen Mansion', description: 'Gothic-style mansion with dark wood interiors.' },
  ];

  const props = [
    { id: '1', name: 'Marriage Contract', description: 'Legal document with golden seal.' },
    { id: '2', name: 'Hidden Diary', description: 'Worn leather diary with handwritten pages.' },
    { id: '3', name: 'Antique Key', description: 'Ornate brass key to the east wing.' },
  ];

  const activeData = activeTab === 'Characters' ? characters : activeTab === 'Scenes' ? scenes : props;

  return (
    <View>
      <View style={{ flexDirection: 'row', marginBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: `${colors.fog}22` }}>
        {assetTabs.map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={{
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderBottomWidth: 2,
              borderBottomColor: activeTab === tab ? '#8B5CF6' : 'transparent',
            }}
          >
            <Text style={{ color: activeTab === tab ? colors.bone : colors.fog, fontSize: 14, fontWeight: '600' }}>{tab}</Text>
          </Pressable>
        ))}
      </View>
      {activeData.map((item) => (
        <View
          key={item.id}
          style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md, flexDirection: 'row' }}
        >
          <View
            style={{
              width: 60,
              height: 70,
              backgroundColor: `${colors.fog}22`,
              borderRadius: 8,
              justifyContent: 'center',
              alignItems: 'center',
              marginRight: spacing.md,
            }}
          >
            <Text style={{ color: colors.fog, fontSize: 24 }}>
              {activeTab === 'Characters' ? '👤' : activeTab === 'Scenes' ? '🏠' : '📦'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.fog, fontSize: 12, lineHeight: 18, marginBottom: spacing.sm }}>{item.description}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ backgroundColor: `${colors.fog}22`, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 4 }}>
                <Text style={{ color: colors.bone, fontSize: 13 }}>{item.name}</Text>
              </View>
              <Pressable>
                <Text style={{ color: '#8B5CF6', fontSize: 13, fontWeight: '600' }}>Generate</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}
