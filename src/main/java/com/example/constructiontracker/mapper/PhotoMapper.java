package com.example.constructiontracker.mapper;

import com.example.constructiontracker.domain.PhotoFile;
import com.example.constructiontracker.domain.PhotoMetadata;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface PhotoMapper {
    PhotoMetadata findByHash(@Param("houseId") Long houseId, @Param("hash") byte[] hash);

    int insert(@Param("photo") PhotoMetadata photo, @Param("hash") byte[] hash,
               @Param("storageKey") String storageKey);

    PhotoFile findFile(@Param("houseId") Long houseId, @Param("photoId") Long photoId);
}
