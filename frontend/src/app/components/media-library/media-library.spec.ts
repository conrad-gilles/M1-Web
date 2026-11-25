import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Page } from '../../shared/models/page.model';
import { Media } from '../../shared/models/media.model';
import { VideoConverterService } from '../../shared/services/video-converter.service';
import { MediaLibraryComponent } from './media-library';

const track = (id: string, title = `Morceau ${id}`): Media => ({
  id,
  source: 'upload',
  duration: null,
  folder: null,
  owner: null,
  kind: 'audio',
  title,
  originalName: `${id}.mp3`,
  mimeType: 'audio/mpeg',
  size: 2048,
  createdAt: '2026-10-01T10:00:00.000Z',
});

const page = (items: Media[], current = 1, pages = 1): Page<Media> => ({
  items,
  page: current,
  limit: 5,
  total: items.length,
  pages,
});

describe('MediaLibraryComponent', () => {
  let fixture: ComponentFixture<MediaLibraryComponent>;
  let component: MediaLibraryComponent;
  let http: HttpTestingController;
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let converter: { toMp4: ReturnType<typeof vi.fn> };
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  /** Requête GET de liste (l'upload POST partage la même URL). */
  const expectList = (pageNumber: number): TestRequest =>
    http.expectOne(
      (req) =>
        req.method === 'GET' && req.url === '/api/media' && req.params.get('page') === String(pageNumber),
    );

  /** Crée le composant sans répondre à la liste initiale. */
  const createPending = () => {
    fixture = TestBed.createComponent(MediaLibraryComponent);
    component = fixture.componentInstance;
  };

  /** Crée le composant et répond à la liste initiale (page 1). */
  const create = (initial: Page<Media> = page([track('a'), track('b')])) => {
    createPending();
    expectList(1).flush(initial);
    fixture.detectChanges();
  };

  beforeEach(() => {
    localStorage.clear();
    snackBar = { open: vi.fn() };
    converter = { toMp4: vi.fn() };
    confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBar },
        // Le vrai convertisseur charge FFmpeg (WebAssembly) : testé de bout en bout.
        { provide: VideoConverterService, useValue: converter },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    confirmSpy.mockRestore();
    localStorage.clear();
  });

  describe('bibliothèque', () => {
    it('charge la page 1 avec page et limit puis affiche une card par piste', () => {
      createPending();
      const request = expectList(1);
      expect(request.request.params.get('limit')).toBe('5');
      request.flush(page([track('a'), track('b')]));
      fixture.detectChanges();

      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.media-card');
      expect(cards.length).toBe(2);
      expect(cards[0].textContent).toContain('Morceau a');
    });

    it("affiche un message d'erreur après un échec HTTP", () => {
      createPending();
      expectList(1).flush({ message: 'Erreur serveur' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(component.listError()).toBe('Erreur serveur');
      expect(component.loading()).toBe(false);
      const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('Erreur serveur');
    });

    it('go() fait une nouvelle requête avec la page demandée', () => {
      create(page([track('a')], 1, 3));

      component.go(2);

      expectList(2).flush(page([track('c')], 2, 3));
      expect(component.page()).toBe(2);
      expect(component.medias()[0].id).toBe('c');
    });

    it('go() ne fait aucune requête hors des bornes ni sur la page courante', () => {
      create(page([track('a')], 1, 3));

      component.go(0);
      component.go(4);
      component.go(1);
      // http.verify() (afterEach) échoue si une requête a été envoyée
    });
  });

  describe('suppression', () => {
    it('affiche un bouton « Supprimer » dans chaque card', () => {
      create();

      const buttons = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.media-card .danger'),
      );
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Supprimer', 'Supprimer']);
    });

    it("n'envoie aucune requête quand la confirmation est refusée", () => {
      create();
      confirmSpy.mockReturnValue(false);

      component.remove(track('a'));

      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(component.deletingId()).toBeNull();
      expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('appelle DELETE /api/media/:id, notifie puis recharge la liste', () => {
      create();

      component.remove(track('a', 'Blues'));

      const del = http.expectOne('/api/media/a');
      expect(del.request.method).toBe('DELETE');
      expect(component.deletingId()).toBe('a');
      del.flush(null, { status: 204, statusText: 'No Content' });

      expect(component.deletingId()).toBeNull();
      expect(snackBar.open).toHaveBeenCalledWith('« Blues » a été supprimé.', 'OK', expect.anything());
      expectList(1).flush(page([track('b')]));
      expect(component.medias().map((t) => t.id)).toEqual(['b']);
    });

    it("ignore un second clic pendant qu'une suppression est en cours", () => {
      create();

      component.remove(track('a'));
      component.remove(track('b'));

      // expectOne échouerait s'il y avait deux requêtes DELETE
      http.expectOne((req) => req.method === 'DELETE').flush(null, { status: 204, statusText: 'No Content' });
      expectList(1).flush(page([]));
      expect(confirmSpy).toHaveBeenCalledOnce();
    });

    it("404 : le média n'existe plus → message + rechargement", () => {
      create();

      component.remove(track('a'));
      http
        .expectOne('/api/media/a')
        .flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });

      expect(component.deletingId()).toBeNull();
      expect(snackBar.open).toHaveBeenCalledWith(
        expect.stringContaining("n'existe plus"),
        'OK',
        expect.anything(),
      );
      // La card obsolète disparaît après le rechargement.
      expectList(1).flush(page([track('b')]));
      expect(component.medias().map((t) => t.id)).toEqual(['b']);
    });

    it('autre erreur : affiche le message du serveur sans recharger', () => {
      create();

      component.remove(track('a'));
      http
        .expectOne('/api/media/a')
        .flush({ message: 'Erreur interne' }, { status: 500, statusText: 'Server Error' });

      expect(component.deletingId()).toBeNull();
      expect(snackBar.open).toHaveBeenCalledWith('Erreur interne', 'OK', expect.anything());
      expect(component.medias().length).toBe(2); // liste inchangée, aucun GET supplémentaire
    });

    it("recule d'une page quand la dernière piste de la page courante est supprimée", () => {
      create(page([track('a')], 1, 2));
      component.go(2);
      expectList(2).flush(page([track('z')], 2, 2));

      component.remove(track('z'));
      http.expectOne('/api/media/z').flush(null, { status: 204, statusText: 'No Content' });
      // La page 2 est maintenant vide : le serveur ne compte plus qu'une page.
      expectList(2).flush({ items: [], page: 2, limit: 5, total: 5, pages: 1 });
      expectList(1).flush(page([track('a')], 1, 1));

      expect(component.page()).toBe(1);
      expect(component.medias().map((t) => t.id)).toEqual(['a']);
    });
  });

  describe('upload', () => {
    const audioFile = () => new File(['abc'], 'song.mp3', { type: 'audio/mpeg' });
    const postRequest = () => http.expectOne((req) => req.method === 'POST' && req.url === '/api/media');

    it('commence à idle', () => {
      create();
      expect(component.uploadState()).toEqual({ status: 'idle' });
    });

    it('met à jour le pourcentage, désactive le formulaire et bloque une seconde soumission', () => {
      create();
      component.file = audioFile();
      component.title.setValue('Mon titre');

      component.upload();
      expect(component.uploadState()).toEqual({ status: 'uploading', percent: 0 });
      expect(component.title.disabled).toBe(true);

      const request = postRequest();
      request.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 200 });
      fixture.detectChanges();
      expect(component.uploadState()).toEqual({ status: 'uploading', percent: 25 });

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('progress')?.getAttribute('value')).toBe('25');
      expect(root.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
      expect(root.querySelector<HTMLButtonElement>('.card button')?.disabled).toBe(true);

      component.upload(); // ignoré : une seconde requête ferait échouer http.verify()
      request.flush(track('new', 'Mon titre'));
      expectList(1).flush(page([track('new', 'Mon titre')]));
    });

    it('barre indéterminée quand la taille totale est inconnue', () => {
      create();
      component.file = audioFile();

      component.upload();
      const request = postRequest();
      request.event({ type: HttpEventType.UploadProgress, loaded: 10 });

      expect(component.uploadState()).toEqual({ status: 'uploading', percent: null });
      request.flush(track('new'));
      expectList(1).flush(page([track('new')]));
    });

    it('succès : état success, formulaire vidé et première page rechargée', () => {
      create(page([track('a')], 1, 2));
      component.go(2);
      expectList(2).flush(page([track('z')], 2, 2));
      component.file = audioFile();
      component.title.setValue('Mon titre');

      component.upload();
      const request = postRequest();
      expect(request.request.reportProgress).toBe(true);
      expect((request.request.body as FormData).get('title')).toBe('Mon titre');
      request.flush(track('new', 'Mon titre'));

      expect(component.uploadState()).toEqual({ status: 'success', title: 'Mon titre' });
      expect(component.uploadSuccess()).toContain('Mon titre');
      expect(component.file).toBeUndefined();
      expect(component.title.value).toBe('');
      expect(component.title.enabled).toBe(true);
      expect(component.page()).toBe(1);
      expectList(1).flush(page([track('new', 'Mon titre')]));
    });

    it('échec : état error avec le message du serveur, formulaire réactivé', () => {
      create();
      component.file = audioFile();

      component.upload();
      postRequest().flush({ message: 'Format de média non accepté' }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(component.uploadState()).toEqual({ status: 'error', message: 'Format de média non accepté' });
      expect(component.title.enabled).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Format de média non accepté');

      // Un nouvel essai est possible après l'échec.
      component.upload();
      postRequest().flush(track('ok'));
      expectList(1).flush(page([track('ok')]));
    });

    it('envoie le titre par défaut (nom du fichier) quand le titre est vide', () => {
      create();
      component.file = audioFile();

      component.upload();
      const request = postRequest();

      expect((request.request.body as FormData).get('title')).toBe('song.mp3');
      request.flush(track('new'));
      expectList(1).flush(page([track('new')]));
    });

    describe('vidéo MOV/AVI/MKV convertie avant l’envoi', () => {
      const mkv = () => new File(['matroska'], 'Vacances.mkv', { type: 'video/x-matroska' });
      const mp4 = (size = 3) => {
        const file = new File(['mp4'], 'Vacances.mp4', { type: 'video/mp4' });
        Object.defineProperty(file, 'size', { value: size });
        return file;
      };
      /** Laisse se terminer la promesse de conversion. */
      const settle = () => new Promise((resolve) => setTimeout(resolve));

      it('n’appelle pas le convertisseur pour un fichier déjà lisible', () => {
        create();
        component.file = audioFile();

        component.upload();

        expect(converter.toMp4).not.toHaveBeenCalled();
        postRequest().flush(track('new'));
        expectList(1).flush(page([track('new')]));
      });

      it('convertit, affiche la progression, puis envoie le MP4', async () => {
        create();
        let reportProgress!: (percent: number) => void;
        let finish!: (file: File) => void;
        converter.toMp4.mockImplementation((_file: File, onProgress: (percent: number) => void) => {
          reportProgress = onProgress;
          return new Promise<File>((resolve) => (finish = resolve));
        });
        component.file = mkv();

        component.upload();
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        expect(component.uploadState()).toEqual({ status: 'converting', percent: null });
        expect(root.textContent).toContain('chargement du convertisseur');
        expect(root.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);

        reportProgress(40);
        fixture.detectChanges();
        expect(component.uploadState()).toEqual({ status: 'converting', percent: 40 });
        expect(root.querySelector('progress')?.getAttribute('value')).toBe('40');

        component.upload(); // ignoré pendant la conversion
        expect(converter.toMp4).toHaveBeenCalledTimes(1);

        finish(mp4());
        await settle();
        const request = postRequest();
        const sent = (request.request.body as FormData).get('file') as File;
        expect(sent.name).toBe('Vacances.mp4');
        expect(sent.type).toBe('video/mp4');
        // Le titre par défaut reste le nom choisi par l'utilisateur.
        expect((request.request.body as FormData).get('title')).toBe('Vacances.mkv');
        request.flush(track('new'));
        expectList(1).flush(page([track('new')]));
        expect(component.uploadState()).toEqual({ status: 'success', title: 'Morceau new' });
      });

      it('échec de conversion : message clair, rien n’est envoyé, nouvel essai possible', async () => {
        create();
        converter.toMp4.mockRejectedValue(new Error('FFmpeg a échoué (code 1)'));
        component.file = mkv();

        component.upload();
        await settle();
        fixture.detectChanges();

        expect(component.uploadState()).toEqual({
          status: 'error',
          message: 'Conversion impossible : ce fichier vidéo est illisible ou utilise un format non pris en charge.',
        });
        expect(component.title.enabled).toBe(true);
        expect(component.busy()).toBe(false);
      });

      it('envoie un résultat de plus de 25 Mo : aucune limite de taille', async () => {
        create();
        converter.toMp4.mockResolvedValue(mp4(30 * 1024 * 1024));
        component.file = mkv();

        component.upload();
        await settle();

        const request = postRequest();
        expect(((request.request.body as FormData).get('file') as File).size).toBe(30 * 1024 * 1024);
        request.flush(track('new'));
        expectList(1).flush(page([track('new')]));
      });
    });

    it("n'envoie rien sans fichier choisi", () => {
      create();

      component.upload();

      expect(component.uploadState()).toEqual({ status: 'idle' });
    });

    it('rejette un fichier invalide avant tout appel HTTP', () => {
      create();
      const input = { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })], value: 'notes.txt' };

      component.choose({ target: input } as unknown as Event);

      expect(component.file).toBeUndefined();
      expect(component.fileError()).toContain('Format non supporté');
      expect(input.value).toBe('');
      // http.verify() (afterEach) garantit qu'aucune requête n'est partie
    });
  });

  describe('lecture', () => {
    it('signale le média choisi sans le charger elle-même', () => {
      create();
      const selected: Media[] = [];
      component.selected.subscribe((media) => selected.push(media));

      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.media-actions button')?.click();

      expect(selected.map((media) => media.id)).toEqual(['a']);
      // http.verify() (afterEach) garantit qu'aucune requête n'est partie
    });

    it('met en évidence le média chargé dans le lecteur du salon', () => {
      create();

      fixture.componentRef.setInput('activeMediaId', 'b');
      fixture.detectChanges();

      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.media-card');
      expect(cards[0].classList.contains('playing')).toBe(false);
      expect(cards[1].classList.contains('playing')).toBe(true);
      expect(cards[1].textContent).toContain('Dans le lecteur');
    });
  });

  describe('filtre et validation', () => {
    it('filtre la page affichée par titre, sans requête', () => {
      create(page([track('a', 'Blues du soir'), track('b', 'Jazz manouche')]));

      component.filterText.set('  JAZZ ');
      fixture.detectChanges();

      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.media-card');
      expect(cards.length).toBe(1);
      expect(cards[0].textContent).toContain('Jazz manouche');

      component.filterText.set('aucun');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Aucun média ne correspond à ce filtre');
    });

    it('accepte un fichier de plus de 25 Mo sans avertissement (moins de 1 Go)', () => {
      create();
      const big = new File(['x'], 'long.mp4', { type: 'video/mp4' });
      Object.defineProperty(big, 'size', { value: 300 * 1024 * 1024 });

      component.choose({ target: { files: [big], value: 'long.mp4' } } as unknown as Event);

      expect(component.fileError()).toBe('');
      expect(component.fileWarning()).toBe('');
      expect(component.file?.name).toBe('long.mp4');
    });

    it('avertit sans bloquer à partir de 1 Go (quota de lecture gratuit)', () => {
      create();
      const huge = new File(['x'], 'film.mp4', { type: 'video/mp4' });
      Object.defineProperty(huge, 'size', { value: 1.5 * 1024 ** 3 });

      component.choose({ target: { files: [huge], value: 'film.mp4' } } as unknown as Event);
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(component.file?.name).toBe('film.mp4');
      expect(root.querySelector('.message.warning')?.textContent).toContain(
        'Fichier de 1.5 Go : le stockage gratuit ne permet que 1 Go de lecture par jour',
      );
      expect(root.querySelector<HTMLButtonElement>('.card button')?.disabled).toBe(false);
    });

    it('le serveur plein (507) affiche son message clair', () => {
      create();
      component.file = new File(['abc'], 'song.mp3', { type: 'audio/mpeg' });

      component.upload();
      http
        .expectOne((req) => req.method === 'POST' && req.url === '/api/media')
        .flush(
          { message: 'Espace de stockage gratuit épuisé : supprimez des médias du salon ou réessayez plus tard.' },
          { status: 507, statusText: 'Insufficient Storage' },
        );
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain(
        'Espace de stockage gratuit épuisé',
      );
      expect(component.title.enabled).toBe(true);
    });

    it('accepte un fichier sans type MIME grâce à son extension', () => {
      create();
      const input = { files: [new File(['x'], 'piste.m4a', { type: '' })], value: 'piste.m4a' };

      component.choose({ target: input } as unknown as Event);

      expect(component.fileError()).toBe('');
      expect(component.file?.name).toBe('piste.m4a');
    });

    it('accepte une vidéo MP4', () => {
      create();
      const input = { files: [new File(['x'], 'clip.mp4', { type: 'video/mp4' })], value: 'clip.mp4' };

      component.choose({ target: input } as unknown as Event);

      expect(component.fileError()).toBe('');
      expect(component.file?.name).toBe('clip.mp4');
    });

    it('accepte une vidéo MOV/AVI/MKV de plus de 25 Mo : elle sera convertie', () => {
      create();
      const avi = new File(['x'], 'film.avi', { type: 'video/x-msvideo' });
      Object.defineProperty(avi, 'size', { value: 80 * 1024 * 1024 });

      component.choose({ target: { files: [avi], value: 'film.avi' } } as unknown as Event);

      expect(component.fileError()).toBe('');
      expect(component.file?.name).toBe('film.avi');
    });

    it('avertit sans bloquer pour une vidéo à convertir de plus de 200 Mo', () => {
      create();
      const mov = new File(['x'], 'film.mov', { type: 'video/quicktime' });
      Object.defineProperty(mov, 'size', { value: 250 * 1024 * 1024 });

      component.choose({ target: { files: [mov], value: 'film.mov' } } as unknown as Event);
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(component.fileError()).toBe('');
      expect(component.file?.name).toBe('film.mov');
      expect(root.querySelector('.message.warning')?.textContent).toContain(
        "Conversion d'un gros fichier (250.0 Mo, 200 Mo recommandés au plus)",
      );
      // L'envoi reste possible.
      expect(root.querySelector<HTMLButtonElement>('.card button')?.disabled).toBe(false);

      // Un autre choix efface l'avertissement.
      const small = new File(['x'], 'clip.mkv', { type: 'video/x-matroska' });
      component.choose({ target: { files: [small], value: 'clip.mkv' } } as unknown as Event);
      fixture.detectChanges();
      expect(component.fileWarning()).toBe('');
      expect(root.querySelector('.message.warning')).toBeNull();
    });

    it("n'avertit pas pour un gros fichier qui n'a pas besoin de conversion", () => {
      create();
      const mp4 = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
      Object.defineProperty(mp4, 'size', { value: 20 * 1024 * 1024 });

      component.choose({ target: { files: [mp4], value: 'clip.mp4' } } as unknown as Event);

      expect(component.fileWarning()).toBe('');
    });

    it('refuse une vidéo dans un format inconnu', () => {
      create();
      const input = { files: [new File(['x'], 'film.wmv', { type: 'video/x-ms-wmv' })], value: 'film.wmv' };

      component.choose({ target: input } as unknown as Event);

      expect(component.file).toBeUndefined();
      expect(component.fileError()).toContain('Format non supporté');
    });

    it('affiche un média local avec son badge et sa durée, sans taille ni format', () => {
      create(
        page([
          { ...track('loc', 'Film du soir'), source: 'local', duration: 5423.48, kind: 'video', size: 1.4e9 },
        ]),
      );

      const card = (fixture.nativeElement as HTMLElement).querySelector('.media-card')!;
      expect(card.querySelector('.badge.local')?.textContent).toContain('Fichier local');
      expect(card.textContent?.replace(/\s+/g, ' ')).toContain('Vidéo · durée 1:30:23');
      expect(card.textContent).not.toContain('Go');
    });

    it('télécharge un média envoyé sous son nom d’origine ; pas de bouton pour un média local', () => {
      create(page([track('a'), { ...track('loc'), source: 'local', duration: 60 }]));
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.media-card');

      expect(cards[1].querySelector('button.download')).toBeNull();
      const button = cards[0].querySelector<HTMLButtonElement>('button.download')!;
      expect(button.title).toContain('quota gratuit de 1 Go de téléchargement par jour');
      button.click();
      http.expectOne('/api/media/a/download').flush({ url: '/api/media/a/stream?token=t', expiresAt: '' });

      expect(click).toHaveBeenCalledTimes(1);
      const link = click.mock.contexts[0] as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/api/media/a/stream?token=t');
      expect(link.download).toBe('a.mp3');
      click.mockRestore();
    });

    it('affiche le dossier d’origine d’un média', () => {
      create(page([{ ...track('a'), folder: 'Ma série' }]));

      expect((fixture.nativeElement as HTMLElement).querySelector('.media-card .folder')?.textContent).toContain(
        'Dossier « Ma série »',
      );
    });

    describe('envoi d’un dossier entier', () => {
      const inFolder = (relativePath: string, type: string, size = 1000) => {
        const file = new File(['x'], relativePath.split('/').pop()!, { type });
        Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
        Object.defineProperty(file, 'size', { value: size });
        return file;
      };
      const chooseFolder = (files: File[]) => {
        component.chooseUploadFolder({ target: { files } } as unknown as Event);
        fixture.detectChanges();
      };
      const postRequest = () => http.expectOne((req) => req.method === 'POST' && req.url === '/api/media');

      it('avant l’envoi : avertissement sur le stockage gratuit partagé, fichiers ignorés listés', () => {
        create();
        chooseFolder([
          inFolder('Musique/a.mp3', 'audio/mpeg', 3 * 1024 * 1024),
          inFolder('Musique/b.mp3', 'audio/mpeg', 2 * 1024 * 1024),
          inFolder('Musique/notes.wma', 'audio/x-ms-wma'),
        ]);

        const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
        expect(text).toContain('Dossier « Musique » : 2 fichier(s), 5.0 Mo.');
        expect(text).toContain('stockage gratuit partagé par tous les salons (10 Go)');
        expect(text).toContain('Ignorés (format non accepté) : notes.wma');
      });

      it('envoie les fichiers un par un avec le nom du dossier, puis recharge la liste', async () => {
        create();
        chooseFolder([inFolder('Musique/a.mp3', 'audio/mpeg'), inFolder('Musique/b.mp3', 'audio/mpeg')]);

        const pending = component.uploadFolder();
        for (const name of ['a.mp3', 'b.mp3']) {
          const request = await vi.waitFor(() => postRequest());
          const body = request.request.body as FormData;
          expect((body.get('file') as File).name).toBe(name);
          expect(body.get('folder')).toBe('Musique');
          expect(body.get('title')).toBe(name);
          request.flush({ ...track(name), folder: 'Musique' });
        }
        await pending;
        expectList(1).flush(page([track('b.mp3'), track('a.mp3')]));
        fixture.detectChanges();

        expect((fixture.nativeElement as HTMLElement).textContent).toContain(
          'Dossier « Musique » : 2 fichier(s) ajouté(s) au salon.',
        );
        expect(component.busy()).toBe(false);
      });

      it('stockage plein (507) : l’envoi s’arrête et explique pourquoi', async () => {
        create();
        chooseFolder([
          inFolder('Musique/a.mp3', 'audio/mpeg'),
          inFolder('Musique/b.mp3', 'audio/mpeg'),
          inFolder('Musique/c.mp3', 'audio/mpeg'),
        ]);

        const pending = component.uploadFolder();
        (await vi.waitFor(() => postRequest())).flush(track('a.mp3'));
        (await vi.waitFor(() => postRequest())).flush(
          { message: 'Espace de stockage gratuit épuisé : supprimez des médias du salon ou réessayez plus tard.' },
          { status: 507, statusText: 'Insufficient Storage' },
        );
        await pending;
        expectList(1).flush(page([track('a.mp3')]));
        fixture.detectChanges();

        http.expectNone((req) => req.method === 'POST');
        expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain(
          'Envoi du dossier arrêté après 1 fichier(s) : Espace de stockage gratuit épuisé',
        );
        expect(component.title.enabled).toBe(true);
      });
    });

    it('formate tailles, dates et types pour l’affichage', () => {
      create();

      expect(component.formatSize(512)).toBe('512 o');
      expect(component.formatSize(2048)).toBe('2.0 Ko');
      expect(component.formatSize(3 * 1024 * 1024)).toBe('3.0 Mo');
      expect(component.formatSize(5 * 1024 ** 4)).toBe('5120.0 Go');
      expect(component.formatMimeType('audio/mpeg')).toBe('MPEG');
      expect(component.formatMimeType('video/mp4')).toBe('MP4');
      expect(component.formatDate('2026-11-15T10:00:00.000Z')).toBe('15 nov. 2026');
    });
  });
});
