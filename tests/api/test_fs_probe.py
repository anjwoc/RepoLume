from __future__ import annotations

from pathlib import Path

import pytest

from api.routes.fs import probe_folder_access


def test_probe_folder_access_reads_the_selected_directory(tmp_path: Path) -> None:
    nested = tmp_path / 'src' / 'feature'
    nested.mkdir(parents=True)
    (tmp_path / 'README.md').write_text('ok', encoding='utf-8')
    (nested / 'service.py').write_text('print("ok")', encoding='utf-8')

    assert probe_folder_access(str(tmp_path)) == {
        'readable': True,
        'name': tmp_path.name,
        'error': None,
        'directories_checked': 3,
        'files_checked': 2,
        'symlinks_skipped': 0,
    }


def test_probe_folder_access_rejects_a_file_path(tmp_path: Path) -> None:
    file_path = tmp_path / 'README.md'
    file_path.write_text('ok', encoding='utf-8')

    with pytest.raises(NotADirectoryError):
        probe_folder_access(str(file_path))


def test_probe_folder_access_surfaces_permission_denial(monkeypatch, tmp_path: Path) -> None:
    def deny(_path: str):
        raise PermissionError('permission denied')

    monkeypatch.setattr('api.routes.fs.os.scandir', deny)

    with pytest.raises(PermissionError, match='permission denied'):
        probe_folder_access(str(tmp_path))


def test_probe_folder_access_reads_files_in_nested_directories(monkeypatch, tmp_path: Path) -> None:
    nested = tmp_path / 'protected'
    nested.mkdir()
    denied = nested / 'secret.py'
    denied.write_text('secret', encoding='utf-8')

    original_open = open

    def deny_nested_file(path, *args, **kwargs):
        if Path(path) == denied:
            raise PermissionError('nested file denied')
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr('builtins.open', deny_nested_file)

    with pytest.raises(PermissionError, match='nested file denied'):
        probe_folder_access(str(tmp_path))


def test_probe_folder_access_does_not_follow_symlinks_outside_project(tmp_path: Path) -> None:
    outside = tmp_path.parent / f'{tmp_path.name}-outside'
    outside.mkdir()
    (outside / 'secret.txt').write_text('secret', encoding='utf-8')
    (tmp_path / 'outside-link').symlink_to(outside, target_is_directory=True)

    result = probe_folder_access(str(tmp_path))

    assert result['readable'] is True
    assert result['directories_checked'] == 1
    assert result['symlinks_skipped'] == 1
