package com.example.constructiontracker.controller;

import com.example.constructiontracker.auth.RequestIdentity;
import com.example.constructiontracker.dto.PhotoResponse;
import com.example.constructiontracker.service.PhotoService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/houses/{houseId}/photos")
public class PhotoController {
    private final PhotoService service;

    public PhotoController(PhotoService service) {
        this.service = service;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<PhotoResponse> upload(@PathVariable Long houseId,
                                               @RequestPart("file") MultipartFile file,
                                               HttpServletRequest request) {
        var result = service.upload(houseId, file, RequestIdentity.get(request));
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(PhotoResponse.from(result.photo()));
    }

    @GetMapping("/{photoId}/file")
    public ResponseEntity<Resource> file(@PathVariable Long houseId, @PathVariable Long photoId) {
        var download = service.file(houseId, photoId);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(download.file().contentType()))
                .contentLength(download.file().fileSize())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Disposition", ContentDisposition.inline().filename(download.file().storageKey()).build().toString())
                .body(download.resource());
    }
}
