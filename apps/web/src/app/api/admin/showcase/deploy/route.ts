import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

export async function GET() {
  const encoder = new TextEncoder();
  const cwd = process.cwd();

  const stream = new ReadableStream({
    start(controller) {
      const send = (line: string) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));

      send('[1/2] 빌드 시작 (NEXT_PUBLIC_SHOWCASE_MODE=true next build)...');

      const build = spawn('pnpm', ['run', 'deploy:vercel'], {
        cwd,
        env: { ...process.env, NEXT_PUBLIC_SHOWCASE_MODE: 'true' },
      });

      build.stdout.on('data', (d: Buffer) =>
        d.toString().split('\n').filter(Boolean).forEach(send));
      build.stderr.on('data', (d: Buffer) =>
        d.toString().split('\n').filter(Boolean).forEach(send));

      build.on('close', (code) => {
        if (code !== 0) {
          send(`[빌드 실패] exit code ${code}`);
          controller.enqueue(encoder.encode('data: __DONE__\n\n'));
          controller.close();
          return;
        }
        send('[2/2] Vercel 배포 중...');

        const deploy = spawn('npx', ['vercel', '--prod', '--yes'], { cwd });

        deploy.stdout.on('data', (d: Buffer) =>
          d.toString().split('\n').filter(Boolean).forEach(send));
        deploy.stderr.on('data', (d: Buffer) =>
          d.toString().split('\n').filter(Boolean).forEach(send));

        deploy.on('close', (dCode) => {
          send(dCode === 0 ? '✅ 배포 완료!' : `❌ 배포 실패 (exit ${dCode})`);
          controller.enqueue(encoder.encode('data: __DONE__\n\n'));
          controller.close();
        });
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
