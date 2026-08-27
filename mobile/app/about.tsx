import {
  PRODUCT_PUBLIC_LINKS,
  PRODUCT_SOURCE_REPOSITORY,
  PRODUCT_SOURCE_REPOSITORY_URL,
  productNameText
} from '@/product-brand'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, GitBranch, Globe, Share2 } from 'lucide-react-native'
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { OrcaLogo } from '../src/components/OrcaLogo'
import {
  MobileGroupedList,
  MobileGroupedListRow,
  MobileIconButton,
  MobileScreenHeader
} from '../src/components/ui'
import type { MobileTheme } from '../src/theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'

function getVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? '?.?.?'
  const build =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber
      : String(Constants.expoConfig?.android?.versionCode ?? '')
  return build ? `v${version} (${build})` : `v${version}`
}

export default function AboutScreen() {
  const sourceRepositoryUrl = PRODUCT_SOURCE_REPOSITORY_URL
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)

  return (
    <View style={styles.screen}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={() => router.back()}
          />
        }
        title={productNameText('关于 Orca')}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.space32 }
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brand}>
          <OrcaLogo size={32} />
          <Text maxFontSizeMultiplier={1.3} style={styles.brandName}>
            {productNameText('Orca')}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.brandDescription}>
            开源智能体开发工作台
          </Text>
        </View>

        {PRODUCT_PUBLIC_LINKS.website || sourceRepositoryUrl || PRODUCT_PUBLIC_LINKS.social ? (
          <MobileGroupedList title="产品链接">
            {PRODUCT_PUBLIC_LINKS.website ? (
              <MobileGroupedListRow
                accessibilityLabel={productNameText('打开 Orca 官方网站')}
                leading={<Globe color={theme.color.text.secondary} size={20} strokeWidth={2} />}
                onPress={() => void Linking.openURL(PRODUCT_PUBLIC_LINKS.website!)}
                title="官方网站"
                trailing={
                  <ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />
                }
              />
            ) : null}
            {sourceRepositoryUrl ? (
              <MobileGroupedListRow
                accessibilityLabel={`打开源代码仓库 ${PRODUCT_SOURCE_REPOSITORY}`}
                leading={<GitBranch color={theme.color.text.secondary} size={20} strokeWidth={2} />}
                onPress={() => void Linking.openURL(sourceRepositoryUrl)}
                title="源代码仓库"
                trailing={
                  <ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />
                }
                value={PRODUCT_SOURCE_REPOSITORY ?? undefined}
              />
            ) : null}
            {PRODUCT_PUBLIC_LINKS.social ? (
              <MobileGroupedListRow
                accessibilityLabel={productNameText('打开 Orca 社交主页')}
                leading={<Share2 color={theme.color.text.secondary} size={20} strokeWidth={2} />}
                onPress={() => void Linking.openURL(PRODUCT_PUBLIC_LINKS.social!)}
                title="社交主页"
                trailing={
                  <ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />
                }
              />
            ) : null}
          </MobileGroupedList>
        ) : null}

        <Text maxFontSizeMultiplier={1.3} style={styles.versionText}>
          版本 {getVersionLabel()}
        </Text>
      </ScrollView>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    content: {
      flexGrow: 1,
      gap: theme.spacing.space24,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20
    },
    brand: {
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space24
    },
    brandName: { ...theme.typography.pageTitle, color: theme.color.text.primary },
    brandDescription: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    versionText: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      textAlign: 'center'
    }
  })
}
