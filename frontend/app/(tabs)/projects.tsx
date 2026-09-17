import { colors, spacing, typography } from '@/src/design-system/tokens';
import { ScrollView, Text, View } from 'react-native';

export default function Projects() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }} showsVerticalScrollIndicator={false}>
        <Text
          style={{
            color: colors.bone,
            fontSize: typography.display.fontSize,
            fontWeight: typography.display.fontWeight,
            letterSpacing: typography.display.letterSpacing,
            marginTop: spacing.xl,
          }}
        >
          PROJECTS
        </Text>
        <Text style={{ color: colors.fog, fontSize: typography.body.fontSize, marginTop: spacing.sm }}>
          Your adaptations and originals — all in one reel.
        </Text>

        <View
          style={{
            marginTop: spacing.xxl,
            borderWidth: 1,
            borderColor: `${colors.fog}33`,
            borderStyle: 'dashed',
            padding: spacing.xl,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.fog, fontSize: typography.mono.fontSize, letterSpacing: 2 }}>
            NO PROJECTS YET
          </Text>
          <Text
            style={{
              color: colors.fog,
              fontSize: typography.body.fontSize,
              marginTop: spacing.sm,
              textAlign: 'center',
            }}
          >
            Create your first story in Studio to see it here.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
