'use client';

import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from '@astryxdesign/core/Icon';
import {useThemeMode} from '@/components/providers/theme-mode';
import {MoonIcon, SunIcon} from '@/components/icons';
import type {Dictionary} from '@/i18n/dictionaries';

export function ThemeToggle({dict}: {dict: Dictionary}) {
  const {resolved, toggle} = useThemeMode();
  const label = resolved === 'dark' ? dict.theme.switchToLight : dict.theme.switchToDark;
  return (
    <IconButton
      label={label}
      tooltip={label}
      variant="ghost"
      onClick={toggle}
      icon={<Icon icon={resolved === 'dark' ? SunIcon : MoonIcon} size="sm" />}
    />
  );
}
