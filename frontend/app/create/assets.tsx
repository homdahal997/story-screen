import { colors, spacing } from '@/src/design-system/tokens';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

const steps = ['Synopsis', 'Script', 'Asset', 'Storyboard', 'Preview'];
const assetTabs = ['Characters', 'Scenes', 'Props'];

const characters = [
  {
    id: '1',
    name: 'Chloe',
    description:
      'Young adult woman, approximately 27 years old; White North American appearance, long chestnut-brown hair in a neat low ponytail, almond-shaped hazel eyes, steady determined gaze, oval face with soft jawline and',
  },
  {
    id: '2',
    name: 'Marcus',
    description:
      'Young adult man, approximately 29 years old; White North American appearance, short dark brown hair parted neatly, deep-set blue-gray eyes with a watchful gaze, strong angular jawline, high cheekbones, straight brow,',
  },
  {
    id: '3',
    name: 'Richard',
    description:
      'Middle-aged man, approximately 58 years old; White North American appearance, salt-and-pepper hair slicked back, narrow gray eyes with cold analytical gaze, gaunt face with deep nasolabial folds, sharp',
  },
];

export default function Assets() {
  const [activeTab, setActiveTab] = useState('Characters');
  const currentStep = 3;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: spacing.lg,
          paddingTop: spacing.xl,
        }}
      >
        <Pressable
          onPress={() => {
            router.replace({
              pathname: '/project/[id]',
              params: { id: '1', title: 'नक़ली विवाह', episodes: '60' },
            });
          }}
          hitSlop={12}
          style={{ padding: 8, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', marginLeft: -8 }}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={{ color: colors.bone, fontSize: 20 }}>✕</Text>
        </Pressable>
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
                  <Text
                    style={{
                      color: index + 1 <= currentStep ? colors.bone : colors.fog,
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                style={{
                  color: index + 1 === currentStep ? colors.bone : colors.fog,
                  fontSize: 10,
                  marginTop: spacing.xs,
                }}
              >
                {step}
              </Text>
            </View>
            {index < steps.length - 1 && (
              <View
                style={{
                  width: 20,
                  height: 1,
                  backgroundColor: index + 1 < currentStep ? '#8B5CF6' : `${colors.fog}44`,
                  marginHorizontal: 4,
                  marginBottom: spacing.md,
                }}
              />
            )}
          </View>
        ))}
      </View>

      {/* Asset Tabs */}
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: spacing.lg,
          marginTop: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: `${colors.fog}22`,
        }}
      >
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
            <Text style={{ color: activeTab === tab ? colors.bone : colors.fog, fontSize: 14, fontWeight: '600' }}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Section Title */}
      <Text
        style={{
          color: colors.bone,
          fontSize: 16,
          fontWeight: '600',
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        }}
      >
        {activeTab}
      </Text>

      {/* Characters List */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}>
        {characters.map((char) => (
          <View
            key={char.id}
            style={{
              backgroundColor: colors.graphite,
              borderRadius: 8,
              padding: spacing.md,
              marginBottom: spacing.md,
              flexDirection: 'row',
            }}
          >
            {/* Character Placeholder */}
            <View style={{ alignItems: 'center', marginRight: spacing.md }}>
              <View
                style={{
                  width: 60,
                  height: 70,
                  backgroundColor: `${colors.fog}22`,
                  borderRadius: 8,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: spacing.xs,
                }}
              >
                <Text style={{ color: colors.fog, fontSize: 24 }}>👤</Text>
              </View>
              <Text style={{ color: colors.fog, fontSize: 9, textAlign: 'center', width: 60 }}>
                Set Character{'\n'}Appearance
              </Text>
            </View>

            {/* Character Info */}
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.fog, fontSize: 12, lineHeight: 18, marginBottom: spacing.sm }}>
                {char.description}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View
                  style={{
                    backgroundColor: `${colors.fog}22`,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                    borderRadius: 4,
                  }}
                >
                  <Text style={{ color: colors.bone, fontSize: 13 }}>{char.name}</Text>
                </View>
                <Pressable onPress={() => alert(`Generating appearance for ${char.name}`)}>
                  <Text style={{ color: '#8B5CF6', fontSize: 13, fontWeight: '600' }}>Generate</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Bottom Button */}
      <View style={{ padding: spacing.lg, paddingBottom: spacing.xl }}>
        <Pressable
          onPress={() => alert('Next: Storyboard')}
          style={{
            backgroundColor: '#8B5CF6',
            paddingVertical: spacing.md,
            borderRadius: 24,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Next: Storyboard</Text>
        </Pressable>
      </View>
    </View>
  );
}
