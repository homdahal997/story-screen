import { colors, spacing } from '@/src/design-system/tokens';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

const steps = ['Synopsis', 'Script', 'Asset', 'Storyboard', 'Preview'];

export default function CreateProject() {
  const { id, title } = useLocalSearchParams<{ id: string; title: string }>();
  const [currentStep, setCurrentStep] = useState(1);
  const [generating, setGenerating] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setGenerating(false), 3000);
    return () => clearTimeout(timer);
  }, []);

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
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/studio');
          }}
          hitSlop={12}
          style={{ padding: 8, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', marginLeft: -8 }}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={{ color: colors.bone, fontSize: 20 }}>✕</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '600' }}>{title || 'Untitled'}</Text>
          <Text style={{ color: colors.fog, fontSize: 14, marginLeft: spacing.xs }}>✎</Text>
        </View>
        <View style={{ width: 20 }} />
      </View>

      {/* Step Progress */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
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
                <Text
                  style={{
                    color: index + 1 <= currentStep ? colors.bone : colors.fog,
                    fontSize: 12,
                    fontWeight: '600',
                  }}
                >
                  {index + 1}
                </Text>
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
                  width: 24,
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

      {/* Main Content — Generation State */}
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
        {generating ? (
          <>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: '#8B5CF6',
                opacity: 0.8,
                marginBottom: spacing.lg,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <ActivityIndicator color={colors.bone} />
            </View>
            <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '600' }}>Creating story outline...</Text>
            <Text style={{ color: colors.fog, fontSize: 14, marginTop: spacing.sm }}>
              Est. time remaining <Text style={{ color: colors.bone, fontWeight: '600' }}>1-2 minutes</Text>
            </Text>
            <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.xs }}>
              AI will keep generating after you exit
            </Text>
          </>
        ) : (
          <>
            <Text style={{ color: '#4ADE80', fontSize: 32, marginBottom: spacing.md }}>✓</Text>
            <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '600' }}>Synopsis complete!</Text>
            <Text style={{ color: colors.fog, fontSize: 14, marginTop: spacing.sm }}>Ready to create your script</Text>
          </>
        )}
      </View>

      {/* Bottom Button */}
      <View style={{ padding: spacing.lg, paddingBottom: spacing.xl }}>
        <Pressable
          onPress={() => {
            if (generating) return;
            if (currentStep === 1) {
              setCurrentStep(2);
              setGenerating(true);
              setTimeout(() => setGenerating(false), 3000);
            } else {
              router.push('/create/assets');
            }
          }}
          disabled={generating}
          style={{
            backgroundColor: generating ? `${colors.fog}44` : '#8B5CF6',
            paddingVertical: spacing.md,
            borderRadius: 24,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>
            {generating ? 'Generating...' : currentStep === 1 ? `Next: Create ${steps[currentStep]}` : 'Next: Asset Setup'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
